const state = {
    messages: [],
    tasks: new Map(),
    agents: new Map(),
    activeTab: 'channel', // Default active tab
    eventSourceConnected: false,
    brokerRetryInterval: null, // For EventSource retry logic
};

function render() {
    const streamElement = document.getElementById('stream');
    if (!streamElement) return;

    streamElement.innerHTML = ''; // Clear current stream
    const composerInput = document.getElementById('composer');
    const sendButton = document.getElementById('send-button');

    // Update tab active classes
    document.querySelectorAll('nav .tab-button').forEach(button => {
        if (button.textContent.toLowerCase() === state.activeTab) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });

    // Update composer state and placeholder
    if (!state.eventSourceConnected) {
        composerInput.placeholder = 'Broker offline';
        composerInput.disabled = true;
        sendButton.disabled = true;
    } else if (state.activeTab === 'channel' || state.activeTab === 'tasks') {
        composerInput.placeholder = 'Cannot send messages in this tab.';
        composerInput.disabled = true;
        sendButton.disabled = true;
    } else {
        composerInput.placeholder = 'Type your message...';
        composerInput.disabled = false;
        sendButton.disabled = false;
    }


    if (state.activeTab === 'tasks') {
        const sortedTasks = Array.from(state.tasks.values()).sort((a, b) => b.id - a.id);
        const escape = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const truncate = (s, n) => (s && s.length > n) ? s.slice(0, n) + '…' : (s || '');

        sortedTasks.forEach(task => {
            const prompt = task.payload && task.payload.message ? task.payload.message : JSON.stringify(task.payload || {}, null, 2);
            const details = document.createElement('details');
            details.className = `task task-status-${task.status}`;

            const summary = document.createElement('summary');
            summary.innerHTML = `
                <span class="task-id">#${task.id}</span>
                <span class="task-assign">${escape(task.assignTo || '?')}</span>
                <span class="task-status-badge">${escape(task.status || '?')}</span>
                <span class="task-age">${formatTaskAge(task.createdAt)}</span>
                <span class="task-preview">${escape(truncate(prompt.split('\n')[0], 100))}</span>
            `;
            details.appendChild(summary);

            const body = document.createElement('div');
            body.className = 'task-body';
            body.innerHTML = `
                <div class="task-section"><div class="task-label">prompt</div><pre>${escape(prompt)}</pre></div>
                ${task.result ? `<div class="task-section"><div class="task-label">result</div><pre>${escape(task.result)}</pre></div>` : ''}
                ${task.status === 'awaiting-approval' ? `<button class="approve-btn" data-id="${task.id}">[Approve]</button>` : ''}
            `;
            details.appendChild(body);
            const approve = body.querySelector('.approve-btn');
            if (approve) approve.addEventListener('click', async (e) => {
                e.preventDefault();
                await fetch(`/api/tasks/${task.id}/approve`, { method: 'POST' });
            });
            streamElement.appendChild(details);
        });

    } else {
        // Render messages
        const targetAgent = state.activeTab === 'channel' ? null : state.activeTab;
        
        const filteredMessages = state.messages.filter(msg => {
            if (state.activeTab === 'channel') {
                return true;
            } else if (targetAgent) {
                const isAssignedTaskUpdate = msg.type === 'task-update' && msg.assignTo === targetAgent;
                const isFromAgent = msg.from === targetAgent;
                const isMention = msg.text && msg.text.toLowerCase().startsWith(`@${targetAgent}`);
                // Optimistic local message from 'you'
                const isToAgent = msg.from === 'you' && msg.text.toLowerCase().includes(`@${targetAgent}`);
                return isFromAgent || isMention || isAssignedTaskUpdate || isToAgent;
            }
            return false;
        });

        // Newest first.
        const ordered = filteredMessages.slice().reverse();
        const fmtTime = (ts) => {
            if (!ts) return '';
            const d = new Date(ts);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        };
        const truncate = (s, n) => (s && s.length > n) ? s.slice(0, n) + '…' : (s || '');

        ordered.forEach(msg => {
            const text = msg.text || '';
            const isLong = text.length > 140 || text.includes('\n');
            const details = document.createElement('details');
            details.className = `msg from-${(msg.from || 'unknown').replace(/[^a-z0-9_-]/gi, '_')}`;
            if (!isLong) details.open = true;

            const summary = document.createElement('summary');
            summary.innerHTML = `<span class="ts">${fmtTime(msg.timestamp)}</span> <span class="from">${msg.from || '?'}</span> <span class="preview">${truncate(text.split('\n')[0], 120)}</span>`;
            details.appendChild(summary);

            if (isLong) {
                const body = document.createElement('pre');
                body.className = 'body';
                body.textContent = text;
                details.appendChild(body);
            }
            streamElement.appendChild(details);
        });

        streamElement.scrollTop = 0; // Newest at top
    }
}

function updateHeaderDots() {
    const brokerDot = document.getElementById('dot-broker');
    const geminiDot = document.getElementById('dot-gemini');
    const claudeDot = document.getElementById('dot-claude');
    const headerButtonsContainer = document.querySelector('header .header-buttons');
    const transitioningIndicator = document.getElementById('transitioning-indicator');

    if (state.eventSourceConnected) {
        brokerDot.className = 'status-dot ok';
        if (transitioningIndicator) {
            transitioningIndicator.remove();
        }
    } else {
        brokerDot.className = 'status-dot down';
        if (!transitioningIndicator) {
            const indicator = document.createElement('span');
            indicator.id = 'transitioning-indicator';
            indicator.textContent = ' (broker offline)';
            headerButtonsContainer.appendChild(indicator);
        }
    }

    // Add tooltip to broker dot
    const lastFiveTasks = Array.from(state.tasks.values())
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5)
        .map(task => `${task.id}: ${task.status}`)
        .join('\n');
    brokerDot.title = `Broker Status:
${state.eventSourceConnected ? 'Online' : 'Offline'}

Last 5 tasks:
${lastFiveTasks || 'No tasks yet'}`;


    // Update agent dots: stale → warn, missing → down, alive → ok.
    ['gemini', 'claude'].forEach(agentName => {
        const agent = state.agents.get(agentName);
        const dot = document.getElementById(`dot-${agentName}`);
        if (!dot) return;
        let cls = 'down';
        if (agent) cls = agent.stale ? 'warn' : 'ok';
        dot.className = `status-dot ${cls}`;
    });
}

async function fetchInitialState() {
    try {
        const [messagesResponse, tasksResponse, agentsResponse] = await Promise.all([
            fetch('/api/messages?limit=200'),
            fetch('/api/tasks'),
            fetch('/api/agents')
        ]);

        const messagesData = await messagesResponse.json();
        const tasksData = await tasksResponse.json();
        const agentsData = await agentsResponse.json();

        state.messages = messagesData.messages || [];
        (tasksData.tasks || []).forEach(task => state.tasks.set(task.id, task));
        (agentsData.agents || []).forEach(agent => state.agents.set(agent.agent, agent));

        render();
        updateHeaderDots();
    } catch (error) {
        console.error('Failed to fetch initial state:', error);
        state.eventSourceConnected = false; // Assume broker is down if initial fetch fails
        updateHeaderDots();
    }
}

function setupEventSource() {
    let eventSource = new EventSource('/api/events');

    eventSource.onopen = () => {
        console.log('EventSource connected');
        state.eventSourceConnected = true;
        updateHeaderDots();
        if (state.brokerRetryInterval) {
            clearInterval(state.brokerRetryInterval);
            state.brokerRetryInterval = null;
        }
    };

    eventSource.onerror = (error) => {
        console.error('EventSource failed:', error);
        state.eventSourceConnected = false;
        updateHeaderDots();
        // Start retry mechanism if not already running
        if (!state.brokerRetryInterval) {
            state.brokerRetryInterval = setInterval(() => {
                console.log('Attempting to reconnect EventSource...');
                eventSource.close(); // Close existing connection before retrying
                eventSource = new EventSource('/api/events'); // Re-initialize EventSource
                setupEventSourceListeners(eventSource); // Re-attach listeners
            }, 5000); // Retry every 5 seconds
        }
    };

    function setupEventSourceListeners(es) {
        // Broker only emits the default `message` event. Payload shape:
        //   { type: 'message', message: { id, team, from, text, type, timestamp, data? } }
        // Inner message.type may be 'chat' or 'task-update' (carries data.taskId/status).
        es.addEventListener('message', (event) => {
            let env;
            try { env = JSON.parse(event.data); } catch { return; }
            if (env.type !== 'message' || !env.message) return;
            const m = env.message;
            state.messages.push(m);
            if (m.type === 'task-update' && m.data && m.data.taskId) {
                const existing = state.tasks.get(m.data.taskId) || { id: m.data.taskId };
                state.tasks.set(m.data.taskId, { ...existing, status: m.data.status, result: m.data.result });
            }
            render();
        });
    }

    setupEventSourceListeners(eventSource);

    // Agent health isn't pushed via SSE — poll every 5s.
    setInterval(async () => {
        try {
            const r = await fetch('/api/agents');
            const d = await r.json();
            state.agents = new Map();
            (d.agents || []).forEach(a => state.agents.set(a.agent, a));
            updateHeaderDots();
        } catch {}
    }, 5000);
}

// Helper functions for tasks tab
function formatTaskAge(createdAt) {
    if (!createdAt) return 'N/A';
    const now = new Date();
    const created = new Date(createdAt);
    const seconds = Math.floor((now - created) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function showTaskModal(task) {
    const modalContent = `
        <h3>Task Details: ${task.id}</h3>
        <pre>${JSON.stringify(task, null, 2)}</pre>
        ${task.status === 'awaiting-approval' ? `<button id="approve-task-button" data-task-id="${task.id}">[Approve]</button>` : ''}
    `;
    createModal(modalContent, async (modalElement) => {
        if (task.status === 'awaiting-approval') {
            const approveButton = modalElement.querySelector('#approve-task-button');
            if (approveButton) {
                approveButton.addEventListener('click', async () => {
                    const taskId = approveButton.dataset.taskId;
                    try {
                        const response = await fetch(`/api/tasks/${taskId}/approve`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({}) // Empty body for approval
                        });
                        if (response.ok) {
                            console.log(`Task ${taskId} approved.`);
                            // Optimistically update status or wait for SSE
                            if (state.tasks.has(taskId)) {
                                const updatedTask = { ...state.tasks.get(taskId), status: 'completed', result: 'Approved by user' };
                                state.tasks.set(taskId, updatedTask);
                                render();
                            }
                            closeModal();
                        } else {
                            console.error('Failed to approve task:', response.statusText);
                            alert('Failed to approve task.');
                        }
                    } catch (error) {
                        console.error('Error approving task:', error);
                        alert('Error approving task.');
                    }
                });
            }
        }
    });
}

function createModal(content, onModalReady = () => {}) {
    let modalOverlay = document.getElementById('modal-overlay');
    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'modal-overlay';
        modalOverlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal();
        });
        document.body.appendChild(modalOverlay);
    }

    const modal = document.createElement('div');
    modal.id = 'modal-content';
    modal.style.cssText = `
        background: #2d2d2d;
        color: #d4d4d4;
        padding: 20px;
        border-radius: 8px;
        max-width: 80%;
        max-height: 80%;
        overflow: auto;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        position: relative;
    `;
    modal.innerHTML = content + '<button style="position:absolute; top:10px; right:10px; background:none; border:none; color:white; font-size:1.2em; cursor:pointer;">&times;</button>';
    modal.querySelector('button').addEventListener('click', closeModal);

    modalOverlay.innerHTML = ''; // Clear previous modal content
    modalOverlay.appendChild(modal);
    modalOverlay.style.display = 'flex';

    onModalReady(modal);
}

function closeModal() {
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.style.display = 'none';
    }
}

async function handleControlAction(action) {
    const headerButtons = document.querySelectorAll('header button');
    const headerButtonsContainer = document.querySelector('header .header-buttons');
    let transitioningIndicator = document.getElementById('transitioning-indicator');

    headerButtons.forEach(button => button.disabled = true);
    if (!transitioningIndicator) {
        transitioningIndicator = document.createElement('span');
        transitioningIndicator.id = 'transitioning-indicator';
        headerButtonsContainer.appendChild(transitioningIndicator);
    }
    transitioningIndicator.textContent = ' (transitioning...)';

    try {
        const response = await fetch(`/api/control/${action}`, { method: 'POST' });
        if (!response.ok) {
            console.error(`Failed to perform ${action} action:`, response.statusText);
            alert(`Failed to perform ${action} action.`);
        } else {
            console.log(`${action} action successful.`);
        }
    } catch (error) {
        console.error(`Error performing ${action} action:`, error);
        alert(`Error performing ${action} action.`);
    } finally {
        setTimeout(() => {
            headerButtons.forEach(button => button.disabled = false);
            if (transitioningIndicator) {
                transitioningIndicator.remove();
            }
        }, 5000);
    }
}

async function handleSendMessage() {
    const composerInput = document.getElementById('composer');
    const messageText = composerInput.value.trim();
    if (!messageText) return;

    const targetAgent = state.activeTab;
    // Composer input and send button are already disabled if broker is offline or tab is wrong
    if (composerInput.disabled) return; 

    // Optimistically add message
    state.messages.push({
        from: 'you',
        text: `@${targetAgent}: ${messageText}`,
        createdAt: new Date().toISOString(),
        type: 'message' // Assuming standard message type
    });
    render();
    composerInput.value = ''; // Clear input

    try {
        const response = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                team: 'factory-v3', // From project context
                assignTo: targetAgent,
                type: 'message',
                payload: { message: messageText }
            })
        });
        if (!response.ok) {
            console.error('Failed to send message:', response.statusText);
            // Optionally revert optimistic update or show error
        }
    } catch (error) {
        console.error('Error sending message:', error);
        // Optionally revert optimistic update or show error
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchInitialState();
    setupEventSource();

    // Setup tab switching
    document.querySelectorAll('nav .tab-button').forEach(button => {
        button.addEventListener('click', () => {
            state.activeTab = button.textContent.toLowerCase();
            render();
        });
    });

    // Composer event listeners
    const composerInput = document.getElementById('composer');
    const sendButton = document.getElementById('send-button');

    sendButton.addEventListener('click', handleSendMessage);
    composerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            composerInput.value = '';
            e.preventDefault();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { // Cmd/Ctrl + Enter
            handleSendMessage();
            e.preventDefault();
        }
    });

    // Control button listeners
    document.querySelector('header button:nth-child(1)').addEventListener('click', () => handleControlAction('up'));
    document.querySelector('header button:nth-child(2)').addEventListener('click', () => handleControlAction('down'));
    document.querySelector('header button:nth-child(3)').addEventListener('click', () => handleControlAction('restart'));
});
