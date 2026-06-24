import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, onValue, update, push, remove, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ============================================================
// MECCA CHAMELEON BACKGROUND CLIP PLAYLIST
// ============================================================
const CLIP_IDS = ["dQw4w9WgXcQ"]; 

(function initBgVideo() {
    const wrapper = document.getElementById('yt-bg-wrapper');
    if (!wrapper || CLIP_IDS.length === 0) return;
    wrapper.classList.add('video-loading');
    let player;
    let currentClipIndex = 0;

    window.onYouTubeIframeAPIReady = function () {
        player = new YT.Player('yt-bg-player', {
            videoId: CLIP_IDS[0],
            playerVars: {
                autoplay: 1,
                mute: 1,
                controls: 0,
                disablekb: 1,
                fs: 0,
                iv_load_policy: 3,
                loop: CLIP_IDS.length === 1 ? 1 : 0,
                playlist: CLIP_IDS.length === 1 ? CLIP_IDS[0] : undefined,
                modestbranding: 1,
                rel: 0,
                showinfo: 0,
            },
            events: {
                onReady(event) {
                    event.target.mute();
                    event.target.playVideo();
                    if(wrapper) wrapper.classList.remove('video-loading');
                },
                onStateChange(event) {
                    if (event.data === YT.PlayerState.ENDED && CLIP_IDS.length > 1) {
                        currentClipIndex = (currentClipIndex + 1) % CLIP_IDS.length;
                        player.loadVideoById(CLIP_IDS[currentClipIndex]);
                    }
                },
            },
        });
    };
})();

// ============================================================
// LOCAL STORAGE & STATE MANAGEMENT
// ============================================================
let myServerId = localStorage.getItem('my_server_id');
if (!myServerId) {
    myServerId = 'srv_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('my_server_id', myServerId);
}

function getMyVotes() {
    try { 
        return JSON.parse(localStorage.getItem('my_votes') || '{}'); 
    } catch { 
        return {}; 
    }
}

function setMyVote(serverId, vote) {
    const votes = getMyVotes();
    if (vote === null) { 
        delete votes[serverId]; 
    } else { 
        votes[serverId] = vote; 
    }
    localStorage.setItem('my_votes', JSON.stringify(votes));
}

let activeServers = [];
let hostIncomingRequests = [];
let leaderboardData = [];
let selectedRegionFilter = "All";
let currentOpenServerId = null;
const ONE_HOUR_MS = 3600000;

function escapeHTML(str) {
    return str ? str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
}

// ============================================================
// RENDER INTERFACE UI
// ============================================================
const renderServerFinder = () => {
    const serverGrid = document.getElementById('server-list');
    if (!serverGrid) return;
    serverGrid.innerHTML = "";

    const filteredServers = activeServers.filter(srv => {
        if (selectedRegionFilter === "All") return true;
        return srv.region === selectedRegionFilter;
    });

    if (filteredServers.length === 0) {
        serverGrid.innerHTML = `<div class="empty-requests">No active lobbies running in ${selectedRegionFilter === "All" ? 'any region' : 'the ' + selectedRegionFilter + ' region'} right now.</div>`;
        return;
    }

    filteredServers.forEach(server => {
        let statusClass = "status-lobby";
        let displayStatus = "In Lobby";
        
        if (server.status === "In-Game") {
            statusClass = "status-ingame"; 
            displayStatus = "In-Game";
        } else if (server.status === "Full" || server.currentPlayers >= server.maxPlayers) {
            statusClass = "status-full"; 
            displayStatus = "Full";
        }

        const myVotes = getMyVotes();
        const myVote = myVotes[server.id] || null;
        const likeCount = server.likes || 0;
        const dislikeCount = server.dislikes || 0;

        const cardHTML = `
            <div class="server-card" style="border-left-color: ${server.id === myServerId ? '#22c55e' : ''}" id="card-${server.id}">
                <div class="server-info">
                    <h3>${escapeHTML(server.host)}'s Hide &amp; Seek Lobby</h3>
                    <div class="server-meta">
                        <span>Region: <strong>${escapeHTML(server.region || 'Unknown')}</strong></span>
                        <span>Players: <strong>${server.currentPlayers} / ${server.maxPlayers}</strong></span>
                    </div>
                </div>
                <div class="server-actions">
                    <div class="vote-buttons">
                        <button class="btn-vote btn-like ${myVote === 'like' ? 'active-like' : ''}" data-server-id="${server.id}" data-vote="like" title="Like this lobby">
                            <span class="vote-count">${likeCount}</span>
                        </button>
                        <button class="btn-vote btn-dislike ${myVote === 'dislike' ? 'active-dislike' : ''}" data-server-id="${server.id}" data-vote="dislike" title="Dislike this lobby">
                            <span class="vote-count">${dislikeCount}</span>
                        </button>
                    </div>
                    <span class="server-status-pill ${statusClass}">${displayStatus}</span>
                    <button class="btn-join" id="btn-view-${server.id}">View Lobby</button>
                </div>
            </div>
        `;
        serverGrid.insertAdjacentHTML('beforeend', cardHTML);

        const viewBtn = document.getElementById(`btn-view-${server.id}`);
        const wholeCard = document.getElementById(`card-${server.id}`);
        
        if (viewBtn) viewBtn.onclick = (e) => { e.stopPropagation(); openServerModal(server.id); };
        if (wholeCard) wholeCard.onclick = () => openServerModal(server.id);

        wholeCard.querySelectorAll('.btn-vote').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                handleVote(btn.dataset.serverId, btn.dataset.vote);
            };
        });
    });
};

const renderHostRequests = () => {
    const requestsList = document.getElementById('requests-list');
    const countBadge = document.getElementById('request-count');
    const closeBtn = document.getElementById('btn-close-server');
    if (!requestsList || !countBadge) return;
         
    countBadge.innerText = hostIncomingRequests.length;
    requestsList.innerHTML = "";

    const hostHasActiveLobby = activeServers.some(s => s.id === myServerId);
    if (closeBtn) {
        if (hostHasActiveLobby) closeBtn.classList.remove('hidden');
        else closeBtn.classList.add('hidden');
    }

    if (hostIncomingRequests.length === 0) {
        requestsList.innerHTML = '<li class="empty-requests">No pending requests</li>';
        return;
    }

    hostIncomingRequests.forEach(req => {
        const li = document.createElement('li');
        li.className = "request-item";
        li.innerHTML = `
            <span class="request-name">${escapeHTML(req.steamId)}</span>
            <div class="request-actions">
                <button class="btn-action btn-accept" id="accept-${req.id}">Accept</button>
                <button class="btn-action btn-decline" id="decline-${req.id}">Drop</button>
            </div>
        `;
        requestsList.appendChild(li);

        const accBtn = document.getElementById(`accept-${req.id}`);
        const decBtn = document.getElementById(`decline-${req.id}`);
        if (accBtn) accBtn.onclick = () => handleRequest(req, 'accept');
        if (decBtn) decBtn.onclick = () => handleRequest(req, 'decline');
    });
};

// ==========================================
// FIREBASE CONFIG & INITIALIZATION
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyBC9ccYUUjyvkAXEdwXAFMT6lc8bd8GX9k",
    authDomain: "mecca-7c082.firebaseapp.com",
    databaseURL: "https://mecca-7c082-default-rtdb.europe-west1.firebasedatabase.app/",
    projectId: "mecca-7c082",
    storageBucket: "mecca-7c082.firebasestorage.app",
    messagingSenderId: "742501688804",
    appId: "1:742501688804:web:a9789ec9a715a2cf2093f1",
    measurementId: "G-72FN44FDJD"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

onValue(ref(db, "servers"), (snapshot) => {
    activeServers = [];
    hostIncomingRequests = [];
    const rightNow = Date.now();

    if (snapshot.exists()) {
        snapshot.forEach((childSnapshot) => {
            const serverData = childSnapshot.val();
            const serverKey = childSnapshot.key;

            if (serverData.lastActive && (rightNow - serverData.lastActive > ONE_HOUR_MS)) {
                remove(ref(db, `servers/${serverKey}`));
                return;
            }

            const rawRequests = serverData.requests || {};
            serverData.requests = Object.values(rawRequests);
                         
            const rawPlayers = serverData.players || {};
            serverData.players = Object.values(rawPlayers);
            
            activeServers.push(serverData);

            if (serverKey === myServerId) {
                hostIncomingRequests = serverData.requests;
                const nameInput = document.getElementById('host-steam-name');
                const regionInput = document.getElementById('host-region');
                const connectionInput = document.getElementById('host-connect-string');
                                 
                if (nameInput && document.activeElement !== nameInput) {
                    nameInput.value = serverData.host || "";
                }
                if (regionInput && document.activeElement !== regionInput) {
                    regionInput.value = serverData.region || "Europe";
                }
                if (connectionInput && document.activeElement !== connectionInput) {
                    connectionInput.value = serverData.connectionString || "";
                }
            }
        });
    }
         
    renderServerFinder();
    renderHostRequests();
    if (currentOpenServerId) {
        updateModalDisplay(currentOpenServerId);
    }
}, (error) => {
    console.error("Firebase Sync Exception: ", error);
});

// ==========================================
// FORM ACTIONS & HANDLERS
// ==========================================
async function handleRequest(requestObject, action) {
    const myServer = activeServers.find(s => s.id === myServerId);
    if (!myServer) return;
    try {
        if (action === 'accept') {
            if (myServer.currentPlayers < myServer.maxPlayers) {
                let nextPlayerCount = myServer.currentPlayers + 1;
                let nextStatus = myServer.status;
                if (nextPlayerCount >= myServer.maxPlayers) { nextStatus = "Full"; }
                                 
                const newPlayerRef = push(ref(db, `servers/${myServerId}/players`));
                await set(newPlayerRef, {
                    id: newPlayerRef.key,
                    steamId: requestObject.steamId
                });
                await update(ref(db, `servers/${myServerId}`), {
                    currentPlayers: nextPlayerCount,
                    status: nextStatus,
                    lastActive: Date.now()
                });
                
                await runTransaction(ref(db, `leaderboard/${myServerId}/totalPlayers`), (count) => (count || 0) + 1);
                await update(ref(db, `leaderboard/${myServerId}`), { hostName: myServer.host });
            } else {
                alert("Lobby completely full!");
                return;
            }
        } else {
            const hostCheck = activeServers.find(s => s.id === myServerId);
            if (hostCheck) await update(ref(db, `servers/${myServerId}`), { lastActive: Date.now() });
        }
        await remove(ref(db, `servers/${myServerId}/requests/${requestObject.id}`));
    } catch (err) {
        alert("Operation Aborted: " + err.message);
    }
}

const regionFilterDropdown = document.getElementById('filter-region');
if (regionFilterDropdown) {
    regionFilterDropdown.onchange = (e) => {
        selectedRegionFilter = e.target.value;
        renderServerFinder();
    };
}

const closeServerBtn = document.getElementById('btn-close-server');
if (closeServerBtn) {
    closeServerBtn.onclick = async () => {
        if (confirm("Are you sure you want to shut down your lobby listing?")) {
            try {
                await remove(ref(db, `servers/${myServerId}`));
                currentOpenServerId = null;
                alert("Server deleted from cloud network dashboard.");
            } catch (err) {
                alert("Shutdown Error: " + err.message);
            }
        }
    };
}

// ==========================================
// MODAL DIALOG INTERFACE
// ==========================================
const modal = document.getElementById('join-modal');

function openServerModal(serverId) {
    currentOpenServerId = serverId;
    updateModalDisplay(serverId);
    if (modal) modal.classList.remove('hidden');
}

function updateModalDisplay(serverId) {
    const targetServer = activeServers.find(s => s.id === serverId);
    if (!targetServer) {
        if (modal) modal.classList.add('hidden');
        currentOpenServerId = null;
        return;
    }
    const idField = document.getElementById('modal-server-id');
    const titleField = document.getElementById('modal-server-title');
    const metaField = document.getElementById('modal-server-meta');
    
    if (idField) idField.value = serverId;
    if (titleField) titleField.innerText = `${escapeHTML(targetServer.host)}'s Hide & Seek`;
    if (metaField) metaField.innerText = `Region: ${targetServer.region} | Status: ${targetServer.status}`;
    
    const rosterList = document.getElementById('modal-players-list');
    const rosterCount = document.getElementById('modal-roster-count');
    if (!rosterList || !rosterCount) return;
    
    rosterList.innerHTML = "";
    
    const activePlayersArray = targetServer.players || [];
    rosterCount.innerText = activePlayersArray.length;
    
    activePlayersArray.forEach(player => {
        const li = document.createElement('li');
        li.className = "modal-player-item";
        li.style.padding = "5px 0";
        if (player.id === 'host_slot' || player.steamId.includes('(Host)')) {
            li.innerHTML = `<strong style="color: #22c55e;">${escapeHTML(player.steamId)}</strong> <span class="server-status-pill status-lobby" style="margin-left:5px; font-size:0.7rem;">Host</span>`;
        } else {
            li.innerHTML = `👤 ${escapeHTML(player.steamId)}`;
        }
        rosterList.appendChild(li);
    });

    const formWrapper = document.getElementById('modal-action-wrapper');
    const lockedMsg = document.getElementById('modal-locked-message');
    const localSavedIdentity = localStorage.getItem('my_requested_steam_id') || "";
         
    const isJoinable = targetServer.status === "Lobby" && (targetServer.currentPlayers < targetServer.maxPlayers);
                 
    if (isJoinable) {
        if (formWrapper) formWrapper.classList.remove('hidden');
        if (lockedMsg) lockedMsg.classList.add('hidden');
                     
        const inputField = document.getElementById('player-steam-id');
        if (inputField && !inputField.value) {
            inputField.value = localSavedIdentity;
        }
    } else {
        if (formWrapper) formWrapper.classList.add('hidden');
        if (lockedMsg) lockedMsg.classList.remove('hidden');
    }
}

const closeBtn = document.getElementById('close-modal-btn');
if (closeBtn && modal) {
    closeBtn.onclick = () => {
        modal.classList.add('hidden');
        currentOpenServerId = null;
    };
}

if (document.getElementById('join-request-form')) {
    document.getElementById('join-request-form').onsubmit = async function(e) {
        e.preventDefault();
        const targetId = document.getElementById('modal-server-id').value;
        const playerSteamId = document.getElementById('player-steam-id').value.trim();
                 
        localStorage.setItem('my_requested_steam_id', playerSteamId);
        const newRequestRef = push(ref(db, `servers/${targetId}/requests`));
        try {
            await set(newRequestRef, { id: newRequestRef.key, steamId: playerSteamId });
            alert("Request submitted successfully! Keep this open until the host accepts.");
            updateModalDisplay(targetId);
        } catch (err) {
            alert("Submission error: " + err.message);
        }
    };
}

if (document.getElementById('host-form')) {
    document.getElementById('host-form').onsubmit = async function(e) {
        e.preventDefault();
        const hostName = document.getElementById('host-steam-name').value;
        const selectedRegion = document.getElementById('host-region').value;
        const maxSlots = parseInt(document.getElementById('host-max-players').value);
        const hostState = document.getElementById('host-status').value;
        const connectionLink = document.getElementById('host-connect-string').value.trim();
        
        const myCurrentServer = activeServers.find(s => s.id === myServerId);
        const existingPlayersCount = myCurrentServer ? myCurrentServer.currentPlayers : 1;
        try {
            await update(ref(db, `servers/${myServerId}`), {
                id: myServerId,
                host: hostName,
                region: selectedRegion,
                maxPlayers: maxSlots,
                currentPlayers: existingPlayersCount > maxSlots ? maxSlots : existingPlayersCount,
                status: hostState,
                connectionString: connectionLink,
                lastActive: Date.now()
            });
            await set(ref(db, `servers/${myServerId}/players/host_slot`), {
                id: 'host_slot',
                steamId: hostName + " (Host)"
            });
            await update(ref(db, `leaderboard/${myServerId}`), { hostName: hostName });
            alert("Your live regional server listing has been updated!");
        } catch (err) {
            alert("Publishing Failure: " + err.message);
        }
    };
}

// ==========================================
// VOTE INFRASTRUCTURE SYSTEM
// ==========================================
async function handleVote(serverId, vote) {
    const myVotes = getMyVotes();
    const currentVote = myVotes[serverId] || null;
    try {
        if (currentVote === vote) {
            await runTransaction(ref(db, `servers/${serverId}/${vote}s`), (count) => Math.max(0, (count || 0) - 1));
            setMyVote(serverId, null);
        } else {
            if (currentVote) {
                await runTransaction(ref(db, `servers/${serverId}/${currentVote}s`), (count) => Math.max(0, (count || 0) - 1));
            }
            await runTransaction(ref(db, `servers/${serverId}/${vote}s`), (count) => (count || 0) + 1);
            setMyVote(serverId, vote);
        }
    } catch (err) {
        console.error("Vote error:", err);
    }
}

// ==========================================
// LEADERBOARD CONTEXT ENGINE
// ==========================================
const renderLeaderboard = () => {
    const container = document.getElementById('leaderboard-list');
    if (!container) return;
    const ranked = leaderboardData
        .filter(e => e.totalPlayers > 0)
        .sort((a, b) => b.totalPlayers - a.totalPlayers)
        .slice(0, 10);
    if (ranked.length === 0) {
        container.innerHTML = '<div class="leaderboard-empty">No host data yet — be the first to fill a lobby!</div>';
        return;
    }
    container.innerHTML = '';
    ranked.forEach((entry, index) => {
        const rank = index + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
        const rankClass = rank === 1 ? 'lb-gold' : rank === 2 ? 'lb-silver' : rank === 3 ? 'lb-bronze' : '';
        const div = document.createElement('div');
        div.className = `leaderboard-row ${rankClass}`;
        div.innerHTML = `
            <span class="lb-rank">${medal}</span>
            <span class="lb-name">${escapeHTML(entry.hostName)}</span>
            <span class="lb-stat">${entry.totalPlayers.toLocaleString()} <small>players hosted</small></span>
        `;
        container.appendChild(div);
    });
};

onValue(ref(db, "leaderboard"), (snapshot) => {
    leaderboardData = [];
    if (snapshot.exists()) {
        snapshot.forEach((child) => {
            const data = child.val();
            if (data && data.hostName) {
                leaderboardData.push({
                    id: child.key,
                    hostName: data.hostName,
                    totalPlayers: data.totalPlayers || 0
                });
            }
        });
    }
    renderLeaderboard();
});

// ==========================================
// HELP POPUPS MODALS
// ==========================================
const helpModal = document.getElementById('help-modal');
const helpBtn = document.getElementById('help-btn');
const closeHelpBtn = document.getElementById('close-help-modal-btn');

if (helpBtn && helpModal) {
    helpBtn.onclick = () => helpModal.classList.remove('hidden');
}
if (closeHelpBtn && helpModal) {
    closeHelpBtn.onclick = () => helpModal.classList.add('hidden');
}
if (helpModal) {
    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) helpModal.classList.add('hidden');
    });
}