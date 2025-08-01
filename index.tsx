/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Chat } from "@google/genai";

type VisitorStatus = 'Pending' | 'Approved' | 'Rejected' | 'Checked-in' | 'Checked-out';
type AppView = 'login' | 'dashboard' | 'overview';
type UserRole = 'Admin' | 'Security' | 'Officer' | 'Resident';

interface Visitor {
    id: number;
    name: string;
    contact: string;
    purpose: string;
    resident: string; // This is the unit number e.g., A-101
    block?: string;
    houseNo?: string;
    vehicle?: string;
    carBrand?: string;
    photo?: string; // Base64 data URL
    status: VisitorStatus;
    checkInTime?: string; // ISO string
    checkOutTime?: string; // ISO string
}

interface User {
    id: number;
    username: string;
    password?: string; // Not ideal for frontend, but this is a mock
    role: UserRole;
    unitNo?: string; // For residents
}

interface CompanyInfo {
    name: string;
    logo: string; // base64 data URL
    address: string;
    welcomeMessage: string;
    personInCharge: string;
    contactNumber: string;
}

interface Activity {
    id: number;
    message: string;
    timestamp: Date;
}

interface PredefinedUnit {
    block: string;
    houseNo: string;
}

type ChatMessage = { sender: 'user' | 'bot' | 'admin'; text: string };

interface PendingChat {
    id: number;
    userId: number | null;
    userName: string;
    unit: string;
    initialQuery: string;
    messages: ChatMessage[];
    dismissed: boolean;
    adminReplied: boolean;
}

// --- MOCK DATA (Fallback for first load) ---
const mockUsers: User[] = [
    { id: 1, username: 'admin', password: 'password', role: 'Admin' },
    { id: 2, username: 'security', password: 'password', role: 'Security' },
    { id: 3, username: 'officer', password: 'password', role: 'Officer' },
    { id: 4, username: 'resident101', password: 'password', role: 'Resident', unitNo: 'A-101' },
    { id: 5, username: 'resident203', password: 'password', role: 'Resident', unitNo: 'B-203' },
];

const mockUnits: PredefinedUnit[] = [
    { block: 'A', houseNo: '101' }, { block: 'A', houseNo: '102' }, { block: 'A', houseNo: '103' },
    { block: 'B', houseNo: '201' }, { block: 'B', houseNo: '202' }, { block: 'B', houseNo: '203' },
    { block: 'C', houseNo: '301' }, { block: 'C', houseNo: '305' }, { block: 'D', houseNo: '401' },
];

const mockVisitors: Visitor[] = [
    { id: 1, name: 'ALICE JOHNSON', contact: '555-1234', purpose: 'DELIVERY', resident: 'A-101', block: 'A', houseNo: '101', status: 'Approved', vehicle: 'XYZ 123', carBrand: 'TOYOTA' },
    { id: 2, name: 'BOB WILLIAMS', contact: '555-5678', purpose: 'MAINTENANCE', resident: 'B-203', block: 'B', houseNo: '203', status: 'Checked-in', checkInTime: new Date(Date.now() - 3600 * 1000).toISOString() },
    { id: 3, name: 'CHARLIE BROWN', contact: '555-8765', purpose: 'PERSONAL VISIT', resident: 'C-305', block: 'C', houseNo: '305', status: 'Pending' },
];

const defaultCompanyInfo: CompanyInfo = {
    name: 'ResiGuard Local',
    logo: '',
    address: '123 Security Lane, Suite 100',
    welcomeMessage: 'Welcome to our secure facility.',
    personInCharge: 'Admin User',
    contactNumber: '555-0100',
};

// --- GEMINI API ---
let ai: GoogleGenAI | null = null;
function getAi() {
    if (!ai) {
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
    return ai;
}

// --- DATA PERSISTENCE (LOCALSTORAGE) ---
let saveTimeout: number;

function debounceSave() {
    clearTimeout(saveTimeout);
    saveTimeout = window.setTimeout(() => {
        if (!state.isAuthenticated) return;

        try {
            const dataToSave = {
                visitors: state.visitors,
                users: state.users,
                companyInfo: state.companyInfo,
                predefinedUnits: state.predefinedUnits,
                pendingChats: state.pendingChats,
                sessions: state.sessions,
            };
            localStorage.setItem('resiGuardData', JSON.stringify(dataToSave));
            console.log("Data saved to localStorage.");
        } catch (error) {
            console.error("Failed to save data to localStorage:", error);
            // In a real app, you might want to show a toast notification to the user
        }
    }, 1500); // Debounce for 1.5 seconds
}


// --- SESSION MANAGEMENT HELPERS ---
function createSession(user: User): string {
    const sessionId = crypto.randomUUID();
    const newSessions = { ...state.sessions, [sessionId]: user.id };
    
    // Use setState to update state and trigger the debounced save
    setState({ sessions: newSessions }); 
    
    sessionStorage.setItem('sessionId', sessionId);
    return sessionId;
}

function getSessionUser(): User | null {
    const sessionId = sessionStorage.getItem('sessionId');
    if (!sessionId) return null;

    // Use state.sessions which is populated from localStorage
    const userId = state.sessions[sessionId];
    if (!userId) {
        sessionStorage.removeItem('sessionId'); // Clean up stale session
        return null;
    }
    
    // Use state.users which is populated from localStorage
    return state.users.find(u => u.id === userId) || null;
}

function destroySession() {
    const sessionId = sessionStorage.getItem('sessionId');
    sessionStorage.removeItem('sessionId');

    if (sessionId && state.sessions[sessionId]) {
        const newSessions = { ...state.sessions };
        delete newSessions[sessionId];
        // Use setState to update state and trigger the debounced save
        setState({ sessions: newSessions });
    }
}


// --- STATE MANAGEMENT ---
let state = {
    isLoadingData: true,
    visitors: [] as Visitor[],
    isModalOpen: false,
    editingVisitorId: null as number | null,
    currentView: 'login' as AppView,
    isAuthenticated: false,
    currentUser: null as User | null,
    loginError: '',
    isCompanySetupModalOpen: false,
    companyInfo: {
        name: 'ResiGuard', logo: '', address: '123 Security Lane, Suite 100',
        welcomeMessage: 'Welcome to our secure facility.', personInCharge: 'Admin User', contactNumber: '555-0100',
    },
    isUserRoleModalOpen: false,
    users: [] as User[],
    activityLog: [] as Activity[],
    searchQuery: '',
    predefinedUnits: [] as PredefinedUnit[],
    isUnitManagementModalOpen: false,
    isApprovalModalOpen: false,
    capturedPhotoData: null as string | null,
    cameraStream: null as MediaStream | null,
    isEditUserModalOpen: false,
    editingUserId: null as number | null,
    isChatOpen: false,
    chatState: 'pre-form' as 'pre-form' | 'chatting',
    chatMessages: [] as ChatMessage[],
    isBotTyping: false,
    chatSession: null as Chat | null,
    pendingChats: [] as PendingChat[],
    isChatNotificationModalOpen: false,
    viewingChatId: null as number | null,
    activeChatId: null as number | null,
    sessions: {} as Record<string, number>,
};

function setState(newState: Partial<typeof state>) {
    const oldState = { ...state };
    state = { ...state, ...newState };

    render();

    // List of state keys that should be persisted to localStorage.
    const keysToPersist = ['visitors', 'users', 'companyInfo', 'predefinedUnits', 'pendingChats', 'sessions'];
    
    // Check if any of the persisted keys have actually changed.
    const hasPersistentChange = keysToPersist.some(key =>
        // @ts-ignore
        newState.hasOwnProperty(key) && newState[key] !== oldState[key]
    );

    if (hasPersistentChange && state.isAuthenticated) {
        debounceSave();
    }
}

const MAX_LOG_ENTRIES = 20;
function logActivity(message: string) {
    const newActivity: Activity = {
        id: Date.now(),
        message,
        timestamp: new Date(),
    };
    const updatedLog = [newActivity, ...state.activityLog].slice(0, MAX_LOG_ENTRIES);
    state.activityLog = updatedLog;
}

// --- EVENT HANDLERS ---
function initializeUserSession(user: User) {
    const pendingVisitorsExist = state.visitors.some(v => v.status === 'Pending');
    const shouldShowApprovalModal = ['Admin', 'Officer'].includes(user.role) && pendingVisitorsExist;
    
    const pendingChats = state.pendingChats;
    const pendingChatsExist = pendingChats.some(c => !c.dismissed);
    const shouldShowChatModal = ['Admin', 'Officer'].includes(user.role) && pendingChatsExist;
    
    let userActiveChatId: number | null = null;
    if (user.role === 'Resident') {
        const theirChats = pendingChats
            .filter(c => c.userId === user.id && !c.adminReplied && !c.dismissed)
            .sort((a, b) => b.id - a.id);
        
        if (theirChats.length > 0) {
            userActiveChatId = theirChats[0].id;
            sessionStorage.setItem('activeChatId', userActiveChatId.toString());
        }
    }

    setState({
        isAuthenticated: true,
        currentView: 'dashboard',
        currentUser: user,
        loginError: '',
        isApprovalModalOpen: shouldShowApprovalModal,
        isChatNotificationModalOpen: shouldShowChatModal,
        activeChatId: userActiveChatId,
    });
}

function handleLoginSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    const user = state.users.find(u => u.username === username && u.password === password);

    if (user) {
        createSession(user);
        initializeUserSession(user);
    } else {
        setState({ loginError: 'Invalid username or password.' });
    }
}

function handleLogout() {
    destroySession();
    sessionStorage.removeItem('activeChatId');
    setState({
        isAuthenticated: false,
        currentView: 'login',
        currentUser: null,
        isModalOpen: false,
        editingVisitorId: null,
        isCompanySetupModalOpen: false,
        isUserRoleModalOpen: false,
        isEditUserModalOpen: false,
        isUnitManagementModalOpen: false,
        isApprovalModalOpen: false,
        activityLog: [],
        searchQuery: '',
        // Reset chat state
        isChatOpen: false,
        chatState: 'pre-form',
        chatMessages: [],
        isBotTyping: false,
        chatSession: null,
        viewingChatId: null,
        activeChatId: null,
        isChatNotificationModalOpen: false,
    });
}

function handleRegisterClick() {
    setState({ isModalOpen: true, editingVisitorId: null, capturedPhotoData: null });
}

function handleEditClick(id: number) {
    const visitor = state.visitors.find(v => v.id === id);
    setState({
        isModalOpen: true,
        editingVisitorId: id,
        capturedPhotoData: visitor?.photo || null,
    });
}

function handleCloseModal() {
    stopCameraStream();
    setState({ isModalOpen: false, editingVisitorId: null, capturedPhotoData: null });
}

function handleFormSubmit(event: Event) {
    event.preventDefault();
    stopCameraStream();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);

    const block = (formData.get('block') as string).trim().toUpperCase();
    const houseNo = (formData.get('houseNo') as string).trim();
    const residentUnit = `${block}-${houseNo}`;
    
    const name = (formData.get('name') as string).trim().toUpperCase();
    const purpose = (formData.get('purpose') as string).trim().toUpperCase();
    const vehicle = (formData.get('vehicle') as string).trim().toUpperCase();
    const carBrand = (formData.get('carBrand') as string).trim().toUpperCase();
    const contact = (formData.get('contact') as string).trim();
    const photo = state.capturedPhotoData;

    if (state.editingVisitorId) {
        const updatedVisitors = state.visitors.map(v => {
            if (v.id === state.editingVisitorId) {
                return {
                    ...v, name, contact, purpose, resident: residentUnit,
                    block, houseNo, vehicle, carBrand, photo: photo || v.photo,
                };
            }
            return v;
        });
        logActivity(`Updated details for ${name}.`);
        setState({ visitors: updatedVisitors, isModalOpen: false, editingVisitorId: null, capturedPhotoData: null });
    } else {
        const newVisitor: Visitor = {
            id: Date.now(), name, contact, purpose, resident: residentUnit,
            block, houseNo, vehicle, carBrand, photo: photo || undefined, status: 'Pending',
        };
        logActivity(`Registered new visitor: ${newVisitor.name}`);
        setState({
            visitors: [newVisitor, ...state.visitors],
            isModalOpen: false,
            capturedPhotoData: null,
        });
    }
}

function handleCheckIn(id: number) {
    const visitor = state.visitors.find(v => v.id === id);
    if (visitor) logActivity(`${visitor.name} checked in.`);
    const visitors = state.visitors.map(v => 
        v.id === id ? { ...v, status: 'Checked-in' as VisitorStatus, checkInTime: new Date().toISOString() } : v
    );
    setState({ visitors });
}

function handleCheckOut(id: number) {
    const visitor = state.visitors.find(v => v.id === id);
    if (visitor) logActivity(`${visitor.name} checked out.`);
    const visitors = state.visitors.map(v => 
        v.id === id ? { ...v, status: 'Checked-out' as VisitorStatus, checkOutTime: new Date().toISOString() } : v
    );
    setState({ visitors });
}

function handleApprove(id: number) {
    const visitor = state.visitors.find(v => v.id === id);
    if (visitor) logActivity(`Visit for ${visitor.name} was approved.`);
    const visitors = state.visitors.map(v => 
        v.id === id ? { ...v, status: 'Approved' as VisitorStatus } : v
    );
    const stillPending = visitors.some(v => v.status === 'Pending');
    setState({ visitors, isApprovalModalOpen: state.isApprovalModalOpen && stillPending });
}

function handleReject(id: number) {
    const visitor = state.visitors.find(v => v.id === id);
    if (visitor) logActivity(`Visit for ${visitor.name} was rejected.`);
    const visitors = state.visitors.map(v => 
        v.id === id ? { ...v, status: 'Rejected' as VisitorStatus } : v
    );
    const stillPending = visitors.some(v => v.status === 'Pending');
    setState({ visitors, isApprovalModalOpen: state.isApprovalModalOpen && stillPending });
}

function handleCompanySetupClick() {
    setState({ isCompanySetupModalOpen: true });
}

function handleCloseCompanySetupModal() {
    setState({ isCompanySetupModalOpen: false });
}

function handleCompanySetupFormSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);

    const saveAndSetState = (logoDataUrl: string) => {
        const newCompanyInfo: CompanyInfo = {
            name: formData.get('companyName') as string,
            address: formData.get('companyAddress') as string,
            welcomeMessage: formData.get('welcomeMessage') as string,
            personInCharge: formData.get('personInCharge') as string,
            contactNumber: formData.get('contactNumber') as string,
            logo: logoDataUrl,
        };
        logActivity(`Company profile updated by ${state.currentUser?.username}.`);
        setState({ companyInfo: newCompanyInfo, isCompanySetupModalOpen: false });
    };

    const logoFile = (form.querySelector('#companyLogo') as HTMLInputElement).files?.[0];
    if (logoFile) {
        const reader = new FileReader();
        reader.onload = (e) => saveAndSetState(e.target?.result as string);
        reader.readAsDataURL(logoFile);
    } else {
        saveAndSetState(state.companyInfo.logo);
    }
}

// User Role and Edit Handlers
function handleUserRolesClick() { setState({ isUserRoleModalOpen: true }); }
function handleCloseUserRoleModal() { setState({ isUserRoleModalOpen: false }); }

function handleOpenEditUserModal(id: number) {
    setState({ isEditUserModalOpen: true, editingUserId: id });
}
function handleCloseEditUserModal() {
    setState({ isEditUserModalOpen: false, editingUserId: null });
}

function handleEditUserFormSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const username = (formData.get('username') as string).trim();
    const newPassword = formData.get('newPassword') as string;
    const confirmPassword = formData.get('confirmPassword') as string;

    if (!username) {
        alert('Username cannot be empty.');
        return;
    }
    if (newPassword !== confirmPassword) {
        alert('Passwords do not match.');
        return;
    }

    const isUsernameTaken = state.users.some(u => u.username === username && u.id !== state.editingUserId);
    if (isUsernameTaken) {
        alert('This username is already taken. Please choose another.');
        return;
    }

    const updatedUsers = state.users.map(user => {
        if (user.id === state.editingUserId) {
            logActivity(`Updated user: ${user.username} -> ${username}.`);
            return {
                ...user,
                username,
                password: newPassword ? newPassword : user.password,
            };
        }
        return user;
    });

    setState({ users: updatedUsers, isEditUserModalOpen: false, editingUserId: null });
}

function handleDeleteUser(id: number) {
    const userToDelete = state.users.find(u => u.id === id);
    if (!userToDelete) return;

    if (userToDelete.id === state.currentUser?.id) {
        alert('You cannot delete your own account.');
        return;
    }

    if (userToDelete.role === 'Admin') {
        const adminCount = state.users.filter(u => u.role === 'Admin').length;
        if (adminCount <= 1) {
            alert('You cannot delete the last administrator.');
            return;
        }
    }

    if (confirm(`Are you sure you want to delete user "${userToDelete.username}"? This action cannot be undone.`)) {
        const updatedUsers = state.users.filter(user => user.id !== id);
        logActivity(`Deleted user: ${userToDelete.username}.`);
        setState({ users: updatedUsers });
    }
}

function handleRoleChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const userIdToUpdate = parseInt(select.dataset.userid || '', 10);
    const newRole = select.value as UserRole;

    if (!userIdToUpdate) return;
    
    const isChangingSelf = state.currentUser?.id === userIdToUpdate;
    if (isChangingSelf && newRole !== 'Admin') {
        const adminCount = state.users.filter(u => u.role === 'Admin').length;
        if (adminCount <= 1) {
            alert('You cannot change your role as you are the only administrator. Please assign the Admin role to another user first.');
            select.value = 'Admin'; // Revert dropdown
            return;
        }
    }

    const updatedUsers = state.users.map(user => {
        if (user.id === userIdToUpdate) {
            return { ...user, role: newRole };
        }
        return user;
    });

    setState({ users: updatedUsers });
}

function handleOverviewClick() { setState({ currentView: 'overview' }); }
function handleDashboardClick() { setState({ currentView: 'dashboard' }); }
function handleSearch(event: Event) {
    const input = event.target as HTMLInputElement;
    state.searchQuery = input.value;
    renderGridOnly();
}

// Unit Management Handlers
function handleManageUnitsClick() { setState({ isUnitManagementModalOpen: true }); }
function handleCloseUnitManagementModal() { setState({ isUnitManagementModalOpen: false }); }

function handleAddUnitSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const blockInput = form.querySelector('#newUnitBlock') as HTMLInputElement;
    const houseNoInput = form.querySelector('#newUnitHouseNo') as HTMLInputElement;

    const block = blockInput.value.trim().toUpperCase();
    const houseNo = houseNoInput.value.trim();

    if (!block || !houseNo) { alert('Both Block and House No. are required.'); return; }
    if (state.predefinedUnits.some(u => u.block === block && u.houseNo === houseNo)) { alert('This unit already exists.'); return; }

    const newUnit: PredefinedUnit = { block, houseNo };
    const updatedUnits = [...state.predefinedUnits, newUnit].sort((a, b) => {
        if (a.block < b.block) return -1; if (a.block > b.block) return 1;
        return a.houseNo.localeCompare(b.houseNo, undefined, { numeric: true });
    });
    
    // Use setState to trigger re-render and save to storage
    setState({ predefinedUnits: updatedUnits });
    
    form.reset();
    blockInput.focus();
}

function handleDeleteUnit(block: string, houseNo: string) {
    if (!confirm(`Are you sure you want to delete unit ${block}-${houseNo}? This action cannot be undone.`)) return;
    const updatedUnits = state.predefinedUnits.filter(u => !(u.block === block && u.houseNo === houseNo));
    setState({ predefinedUnits: updatedUnits });
}

// Approval Modal Handlers
function handleCloseApprovalModal() { setState({ isApprovalModalOpen: false }); }

// Camera Handlers
async function handleCameraAction(e: Event) {
    const button = e.currentTarget as HTMLButtonElement;
    const action = button.dataset.action;
    const video = document.getElementById('video-feed') as HTMLVideoElement;
    const videoContainer = document.querySelector('.photo-capture-area') as HTMLElement;

    if (action === 'open' || action === 'retake') {
        stopCameraStream();
        videoContainer.classList.add('capturing');
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: "environment" } } });
            video.srcObject = stream;
            state.cameraStream = stream;
        } catch (err) {
            console.warn("Environment camera not found, trying default.", err);
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                video.srcObject = stream;
                state.cameraStream = stream;
            } catch (mediaErr) {
                alert("Could not access camera. Please check permissions.");
                videoContainer.classList.remove('capturing');
                return;
            }
        }
        button.dataset.action = 'capture'; button.textContent = 'Capture';
    } else if (action === 'capture') {
        const canvas = document.getElementById('photo-canvas') as HTMLCanvasElement;
        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        context?.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        stopCameraStream();
        
        // This will cause a re-render to show the photo and update button text
        setState({ capturedPhotoData: dataUrl });
    }
}

function stopCameraStream() {
    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(track => track.stop());
        state.cameraStream = null;
    }
}

// --- CHATBOT HANDLERS ---
function handleToggleChat() {
    const willBeOpen = !state.isChatOpen;
    if (willBeOpen) {
        // When opening the chat, if the user has an active chat, resume it.
        // Otherwise, show the form to start a new one.
        const activeChat = state.pendingChats.find(c => c.id === state.activeChatId);
        if (activeChat && state.currentUser?.role === 'Resident') {
             setState({
                isChatOpen: true,
                viewingChatId: null,
                chatMessages: activeChat.messages, // Restore messages
                chatState: 'chatting',
            });
        } else {
            // Default to starting a new chat
            setState({
                isChatOpen: true,
                viewingChatId: null, // Clear any admin view
                chatState: 'pre-form', // Show the form
                chatMessages: [],
                activeChatId: null, // Ensure any lingering ID is cleared if we're showing the form
            });
        }
    } else {
        // --- Closing the chat window ---
        const activeChat = state.pendingChats.find(c => c.id === state.activeChatId || c.id === state.viewingChatId);
        const isLockedForUser = state.currentUser?.role === 'Resident' && activeChat?.adminReplied;

        // If the chat is locked, closing it is an acknowledgment. Reset the user's chat state.
        if (isLockedForUser) {
             sessionStorage.removeItem('activeChatId');
             setState({
                isChatOpen: false,
                chatState: 'pre-form',
                chatMessages: [],
                isBotTyping: false,
                chatSession: null,
                activeChatId: null,
                viewingChatId: null,
            });
        } else {
            // If not locked, or for an admin, just close the window.
            // This preserves the resident's activeChatId for later.
            setState({
                isChatOpen: false,
                viewingChatId: null, // Always reset admin view on close
            });
        }
    }
}

async function handleStartChatSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const name = formData.get('chat-name') as string;
    const block = formData.get('chat-block') as string;
    const houseNo = formData.get('chat-houseNo') as string;
    const initialQuery = (formData.get('chat-initial-query') as string).trim();

    if (!name || !block || !houseNo || !initialQuery) {
        alert("Please fill out all fields to start the chat.");
        return;
    }

    const systemInstruction = `You are ResiBot, a helpful AI assistant for the ResiGuard Visitor Management System. You assist both residents and staff. A user has initiated a chat. Their details and initial query are provided in the first message context. Your primary role is to be helpful and answer their questions based on the provided real-time system data which includes a list of all visitors. If you are asked to perform an action (like pre-registering a visitor), state that you will assist and provide a structured summary of the request for confirmation. For example: 'Ok, I can help pre-register a visitor. Please provide their name, purpose of visit, and expected arrival time.'. You can also answer questions about visitor statuses, counts, and details for specific residents. Always be professional, friendly, and concise.`;
    const chatInstance = getAi().chats.create({
        model: 'gemini-2.5-flash',
        config: { systemInstruction },
    });

    const firstUserMessage: ChatMessage = { sender: 'user', text: initialQuery };
    const newChatId = Date.now();

    // Track active chat in both state and tab-specific session storage
    sessionStorage.setItem('activeChatId', newChatId.toString());

    setState({
        chatSession: chatInstance,
        chatState: 'chatting',
        chatMessages: [firstUserMessage],
        isBotTyping: true,
        activeChatId: newChatId,
    });

    try {
        const visitorSummary = state.visitors.map(v => ({
            name: v.name, status: v.status, visiting: v.resident, purpose: v.purpose
        }));
        const context = {
            initiatingUser: { name: name, role: state.currentUser?.role, unit: `${block}-${houseNo}` },
            currentVisitorList: visitorSummary,
        };
        const prompt = `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nUSER'S INITIAL QUERY:\n${initialQuery}`;
        
        const response = await chatInstance.sendMessage({ message: prompt });
        const botText = response.text;
        const firstBotMessage: ChatMessage = { sender: 'bot', text: botText };
        const finalMessages = [firstUserMessage, firstBotMessage];

        const newPendingChat: PendingChat = {
            id: newChatId,
            userId: state.currentUser?.id || null,
            userName: name,
            unit: `${block}-${houseNo}`,
            initialQuery: initialQuery,
            messages: finalMessages,
            dismissed: false,
            adminReplied: false,
        };
        
        const updatedPendingChats = [...state.pendingChats, newPendingChat];
        
        setState({
            chatMessages: finalMessages,
            isBotTyping: false,
            pendingChats: updatedPendingChats,
        });

    } catch (error) {
        console.error("Gemini API Error:", error);
        const errorMessage = "Sorry, I'm having trouble connecting. Please try again later.";
        setState({
            chatMessages: [...state.chatMessages, { sender: 'bot', text: errorMessage }],
            isBotTyping: false,
        });
    }
}

async function handleUserChatSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.querySelector('#chat-input') as HTMLInputElement;
    const userInput = input.value.trim();

    if (!userInput || !state.chatSession || !state.activeChatId) return;

    const userMessage: ChatMessage = { sender: 'user', text: userInput };
    const currentMessages = state.chatMessages.slice();
    currentMessages.push(userMessage);

    setState({ chatMessages: currentMessages, isBotTyping: true });
    
    const updatedPendingChats = state.pendingChats.map(chat =>
        chat.id === state.activeChatId ? { ...chat, messages: currentMessages } : chat
    );
    setState({ pendingChats: updatedPendingChats });

    input.value = '';

    try {
        const response = await state.chatSession.sendMessage({ message: userInput });
        const botText = response.text;
        const botMessage: ChatMessage = { sender: 'bot', text: botText };
        const finalMessages = [...currentMessages, botMessage];

        const finalPendingChats = state.pendingChats.map(chat =>
            chat.id === state.activeChatId ? { ...chat, messages: finalMessages } : chat
        );

        setState({
            chatMessages: finalMessages,
            isBotTyping: false,
            pendingChats: finalPendingChats,
        });

    } catch (error) {
        console.error("Gemini API Error:", error);
        const errorMessage = "Sorry, I'm having trouble connecting right now. Please try again later.";
        const errorMessages = [...currentMessages, { sender: 'bot' as const, text: errorMessage }];
        setState({
            chatMessages: errorMessages,
            isBotTyping: false,
        });
    }
}

async function handleAdminChatSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.querySelector('#chat-input') as HTMLInputElement;
    const adminInput = input.value.trim();

    if (!adminInput || !state.viewingChatId) return;

    const adminMessage: ChatMessage = { sender: 'admin', text: adminInput };

    const updatedPendingChats = state.pendingChats.map(chat => {
        if (chat.id === state.viewingChatId) {
            const newMessages = [...chat.messages, adminMessage];
            // Also update the live chat view
            setState({ chatMessages: newMessages });
            return { ...chat, messages: newMessages, adminReplied: true };
        }
        return chat;
    });
    
    setState({ pendingChats: updatedPendingChats });
    
    input.value = '';
}

function handleCloseChatNotificationModal() { setState({ isChatNotificationModalOpen: false }); }

function handleReplyToChat(chatId: number) {
    const chatToView = state.pendingChats.find(c => c.id === chatId);
    if (!chatToView) return;

    setState({
        isChatNotificationModalOpen: false,
        isChatOpen: true,
        chatState: 'chatting',
        viewingChatId: chatId,
        chatMessages: chatToView.messages,
    });
}

function handleDismissChat(chatId: number) {
    const updatedChats = state.pendingChats.map(c =>
        c.id === chatId ? { ...c, dismissed: true } : c
    );
    const stillPending = updatedChats.some(c => !c.dismissed);
    setState({
        pendingChats: updatedChats,
        isChatNotificationModalOpen: stillPending,
    });
}

// --- HELPERS (continued) ---
function getInitials(name: string): string {
    if (!name) return '??';
    const parts = name.trim().split(' ');
    if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return `${parts[0]?.[0] || ''}`.toUpperCase();
}

function getAvatarColor(name: string): string {
    const avatarColors = ['#e57373', '#81c784', '#64b5f6', '#ffb74d', '#9575cd', '#4db6ac', '#f06292'];
    const colorIndex = (name.charCodeAt(0) || 0) % avatarColors.length;
    return avatarColors[colorIndex];
}

function formatTimeAgo(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 5) return "just now";
    let interval = seconds / 31536000; if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000; if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400; if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600; if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60; if (interval > 1) return Math.floor(interval) + " minutes ago";
    return Math.floor(seconds) + " seconds ago";
}

function formatDateTime(isoString?: string): string {
    if (!isoString) return 'N/A';
    try {
        const date = new Date(isoString);
        return date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });
    } catch (e) {
        return 'Invalid Date';
    }
}

function getHouseNoOptionsHTML(block: string, selectedHouseNo?: string): string {
    if (!block) return '<option value="">-- Select a Block First --</option>';

    const unitsForBlock = state.predefinedUnits
        .filter(u => u.block === block)
        .sort((a, b) => a.houseNo.localeCompare(b.houseNo, undefined, { numeric: true }));

    if (unitsForBlock.length === 0) {
        return '<option value="">-- No Units in this Block --</option>';
    }

    return [
        '<option value="">-- Select House No. --</option>',
        ...unitsForBlock.map(unit =>
            `<option value="${unit.houseNo}" ${unit.houseNo === selectedHouseNo ? 'selected' : ''}>${unit.houseNo}</option>`
        )
    ].join('');
}


// --- RENDER FUNCTIONS ---
function renderLoginPage() {
    return `
        <div class="login-container">
            <div class="login-card">
                 <svg class="login-logo" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="var(--primary-color)"></path>
                    <path d="M2 17L12 22L22 17" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="M2 12L12 17L22 12" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="M2 7L12 12L22 7" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="M12 2L12 12" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
                <h1 class="login-title">ResiGuard</h1>
                <p class="login-subtitle">Secure Visitor Management</p>
                ${state.loginError ? `<div class="login-error">${state.loginError}</div>` : ''}
                <form id="login-form">
                    <div class="form-group">
                        <label for="username">Username</label>
                        <input type="text" id="username" name="username" required>
                    </div>
                    <div class="form-group">
                        <label for="password">Password</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <button type="submit" class="btn btn-primary btn-full-width">Login</button>
                </form>
                <p class="login-hint">Hint: Log in with credentials like admin/password, security/password, or resident101/password.</p>
            </div>
        </div>
    `;
}

function renderHeader() {
    if (!state.currentUser) return '';

    const defaultLogoSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="50" height="50">
            <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.236L19.36 7 12 10.236 4.64 7 12 4.236zM4 9.123l8 4.5V19.9L4 15.4V9.123zm16 0V15.4l-8 4.5V13.623l8-4.5z"/>
        </svg>
    `;

    const logoSrc = state.companyInfo.logo ? state.companyInfo.logo : `data:image/svg+xml;base64,${btoa(defaultLogoSvg)}`;

    return `
        <header class="header">
            <div class="header-branding">
                <img src="${logoSrc}" alt="Company Logo" class="header-logo">
                <div class="header-info-wrapper">
                    <div class="header-title-role">
                        <h1>${state.companyInfo.name || 'Visitor Management System'}</h1>
                        <span class="user-role-badge">${state.currentUser.role}</span>
                    </div>
                    <div class="header-sub-info">
                        ${state.companyInfo.address ? `<span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.1.4-.223.654-.369.257-.146.533-.304.828-.475V5.111a1 1 0 00-1-1H4a1 1 0 00-1 1v12.315a1.8 1.8 0 01.228.859c.074.33.19.643.343.932.152.289.324.55.51.782.186.232.384.44.6.622l.01.008.004.003.002.001a.752.752 0 00.246.136.25.25 0 00.37-.246l-.004-.012-1.292-4.13a.75.75 0 01.943-.944l4.13 1.292a.25.25 0 00.246-.37zM14.25 5.25a.75.75 0 000-1.5H12a.75.75 0 000 1.5h2.25z" clip-rule="evenodd" /></svg>${state.companyInfo.address}</span>` : ''}
                        ${state.companyInfo.personInCharge ? `<span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.095a1.23 1.23 0 00.41-1.412A9.992 9.992 0 0010 12c-2.31 0-4.438.784-6.131 2.095z" /></svg>${state.companyInfo.personInCharge}</span>` : ''}
                        ${state.companyInfo.contactNumber ? `<span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M3.52 7.377a1.858 1.858 0 012.793 0l.228.227.113.113a1.858 1.858 0 010 2.628l-.113.113-.228.228a1.858 1.858 0 01-2.628 0l-.895-.895a.25.25 0 00-.354 0l-.895.895a1.858 1.858 0 01-2.628 0l-.228-.228-.113-.113a1.858 1.858 0 010-2.628l.113-.113.228-.228a1.858 1.858 0 012.628 0l.895.895a.25.25 0 00.354 0l.895-.895zM16.48 7.377a1.858 1.858 0 012.628 0l.228.227.113.113a1.858 1.858 0 010 2.628l-.113.113-.228.228a1.858 1.858 0 01-2.628 0l-.895-.895a.25.25 0 00-.354 0l-.895.895a1.858 1.858 0 01-2.793 0l-.228-.228-.113-.113a1.858 1.858 0 010-2.628l.113-.113.228-.228a1.858 1.858 0 012.793 0l.895.895a.25.25 0 00.354 0l.895-.895z" /></svg>${state.companyInfo.contactNumber}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="header-actions">
                 ${state.currentUser.role === 'Admin' ? `
                    <button id="company-setup-btn" class="btn btn-secondary">Company Profile</button>
                    <button id="user-roles-btn" class="btn btn-secondary">User Roles</button>
                    <button id="unit-management-btn" class="btn btn-secondary">Manage Units</button>
                ` : ''}
                ${['Admin', 'Officer', 'Security'].includes(state.currentUser.role) ? `
                    <button id="overview-btn" class="btn btn-info">Overview</button>
                ` : ''}
                 <button id="logout-btn" class="btn btn-danger">Logout</button>
            </div>
        </header>
    `;
}

function renderDashboardView() {
    return `
        ${renderHeader()}
        <main class="main-content">
            <div class="visitors-header">
                <h2>Visitor Dashboard</h2>
                <div class="visitors-header-actions">
                    <div class="search-bar">
                        <span class="search-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
                            </svg>
                        </span>
                        <input type="search" id="search-input" placeholder="Search by name, resident, vehicle..." value="${state.searchQuery}">
                    </div>
                    ${['Admin', 'Officer', 'Security'].includes(state.currentUser?.role || '') ? `<button id="register-visitor-btn" class="btn btn-primary">Register New Visitor</button>` : ''}
                </div>
            </div>
            <div id="visitor-grid-container">
                ${renderVisitorsGrid()}
            </div>
        </main>
    `;
}

function renderVisitorsGrid() {
    const { currentUser, searchQuery } = state;
    if (!currentUser) return '';

    let filteredVisitors = state.visitors;

    if (currentUser.role === 'Resident') {
        filteredVisitors = filteredVisitors.filter(v => v.resident === currentUser.unitNo);
    }

    if (searchQuery) {
        const lowerCaseQuery = searchQuery.toLowerCase();
        filteredVisitors = filteredVisitors.filter(v => 
            v.name.toLowerCase().includes(lowerCaseQuery) ||
            v.resident.toLowerCase().includes(lowerCaseQuery) ||
            v.purpose.toLowerCase().includes(lowerCaseQuery) ||
            v.vehicle?.toLowerCase().includes(lowerCaseQuery) ||
            v.carBrand?.toLowerCase().includes(lowerCaseQuery)
        );
    }
    
    if (filteredVisitors.length === 0) {
        return `<div class="no-visitors">No visitors found.</div>`;
    }

    const canEdit = ['Admin', 'Officer'].includes(currentUser.role);
    const canApprove = ['Admin', 'Officer'].includes(currentUser.role);
    const canCheckIn = ['Admin', 'Security'].includes(currentUser.role);

    return `
        <div class="visitor-grid">
            ${filteredVisitors.map(visitor => `
                <div class="visitor-card visitor-card-status-${visitor.status.toLowerCase().replace('-', '')}">
                    <div class="card-header">
                        ${visitor.photo ? 
                            `<img src="${visitor.photo}" alt="${visitor.name}" class="visitor-avatar visitor-avatar-img">` :
                            `<div class="visitor-avatar" style="background-color: ${getAvatarColor(visitor.name)};">${getInitials(visitor.name)}</div>`
                        }
                        <div class="visitor-name-status">
                            <h4>${visitor.name}</h4>
                            <div class="status status-${visitor.status.toLowerCase().replace('-', '')}">${visitor.status}</div>
                        </div>
                    </div>
                    <div class="card-body">
                        <ul class="visitor-details">
                            <li><strong>Resident:</strong> ${visitor.resident}</li>
                            <li><strong>Purpose:</strong> ${visitor.purpose}</li>
                            ${visitor.vehicle ? `<li><strong>Vehicle:</strong> ${visitor.vehicle} (${visitor.carBrand || 'N/A'})</li>` : ''}
                            <li><strong>Contact:</strong> ${visitor.contact}</li>
                            ${visitor.checkInTime ? `<li class="visitor-detail-checked-in"><strong>Checked-in:</strong> ${formatDateTime(visitor.checkInTime)}</li>` : ''}
                            ${visitor.checkOutTime ? `<li class="visitor-detail-checked-out"><strong>Checked-out:</strong> ${formatDateTime(visitor.checkOutTime)}</li>` : ''}
                        </ul>
                    </div>
                    <div class="card-footer">
                        <div class="action-buttons">
                            ${visitor.status === 'Pending' && canApprove ? `<button class="btn btn-success btn-small" data-action="approve" data-visitor-id="${visitor.id}">Approve</button>` : ''}
                            ${visitor.status === 'Pending' && canApprove ? `<button class="btn btn-danger btn-small" data-action="reject" data-visitor-id="${visitor.id}">Reject</button>` : ''}
                            ${visitor.status === 'Approved' && canCheckIn ? `<button class="btn btn-info btn-small" data-action="check-in" data-visitor-id="${visitor.id}">Check-in</button>` : ''}
                            ${visitor.status === 'Checked-in' && canCheckIn ? `<button class="btn btn-secondary btn-small" data-action="check-out" data-visitor-id="${visitor.id}">Check-out</button>` : ''}
                            ${canEdit ? `<button class="btn btn-secondary btn-small" data-action="edit" data-visitor-id="${visitor.id}">Edit</button>` : ''}
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderVisitorFormModal() {
    if (!state.isModalOpen) return '';

    const visitor = state.editingVisitorId ? state.visitors.find(v => v.id === state.editingVisitorId) : null;
    const title = visitor ? 'Edit Visitor Details' : 'Register New Visitor';
    
    const blockOptions = [...new Set(state.predefinedUnits.map(u => u.block))].sort();
    
    // Use the new helper for initial render
    const houseNoOptionsHTML = getHouseNoOptionsHTML(visitor?.block || '', visitor?.houseNo);
    
    return `
        <div class="modal-overlay visible">
            <div class="modal-content large">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="close-button" id="close-modal-btn">&times;</button>
                </div>
                <form id="visitor-form">
                    <div class="modal-body-split">
                        <div class="form-column">
                            <h4>Visitor Information</h4>
                            <div class="form-group">
                                <label for="name">Full Name</label>
                                <input type="text" id="name" name="name" class="uppercase-input" value="${visitor?.name || ''}" required>
                            </div>
                            <div class="form-group">
                                <label for="contact">Contact Number</label>
                                <input type="tel" id="contact" name="contact" value="${visitor?.contact || ''}" required>
                            </div>
                            <div class="form-group">
                                <label for="purpose">Purpose of Visit</label>
                                <input type="text" id="purpose" name="purpose" class="uppercase-input" value="${visitor?.purpose || ''}" required>
                            </div>
                            
                            <h4>Resident Details</h4>
                            <div class="form-group-row">
                                <div class="form-group">
                                    <label for="block">Block</label>
                                    <select id="block" name="block" required>
                                        <option value="">-- Select Block --</option>
                                        ${blockOptions.map(b => `<option value="${b}" ${visitor?.block === b ? 'selected' : ''}>${b}</option>`).join('')}
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="houseNo">House No.</label>
                                    <select id="houseNo" name="houseNo" required ${!visitor?.block ? 'disabled' : ''}>
                                        ${houseNoOptionsHTML}
                                    </select>
                                </div>
                            </div>

                            <h4>Vehicle Information (Optional)</h4>
                             <div class="form-group-row">
                                <div class="form-group">
                                    <label for="vehicle">Vehicle Plate</label>
                                    <input type="text" id="vehicle" name="vehicle" class="uppercase-input" value="${visitor?.vehicle || ''}">
                                </div>
                                <div class="form-group">
                                    <label for="carBrand">Car Brand</label>
                                    <input type="text" id="carBrand" name="carBrand" class="uppercase-input" value="${visitor?.carBrand || ''}">
                                </div>
                            </div>
                        </div>

                        <div class="form-column">
                             <div class="camera-section">
                                <label for="photo-capture">Visitor Photo</label>
                                <div class="photo-capture-area ${state.cameraStream ? 'capturing' : ''}">
                                    <img id="photo-preview" src="${state.capturedPhotoData || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}" alt="Visitor photo preview">
                                    <video id="video-feed" autoplay playsinline></video>
                                    <canvas id="photo-canvas" style="display: none;"></canvas>
                                </div>
                                <div class="camera-controls">
                                    <button type="button" class="btn btn-secondary" id="camera-action-btn" data-action="${state.cameraStream ? 'capture' : (state.capturedPhotoData ? 'retake' : 'open')}">
                                        ${state.cameraStream ? 'Capture' : (state.capturedPhotoData ? 'Retake Snapshot' : 'Take Snapshot')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" id="cancel-modal-btn">Cancel</button>
                        <button type="submit" class="btn btn-primary">${visitor ? 'Save Changes' : 'Register Visitor'}</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderCompanySetupModal() {
    if (!state.isCompanySetupModalOpen) return '';

    return `
        <div class="modal-overlay visible">
            <div class="modal-content standard">
                <div class="modal-header">
                    <h3>Company Profile Setup</h3>
                    <button class="close-button" id="close-company-setup-btn">&times;</button>
                </div>
                <form id="company-setup-form">
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="companyName">Company/Residence Name</label>
                            <input type="text" id="companyName" name="companyName" value="${state.companyInfo.name}" required>
                        </div>
                        <div class="form-group">
                            <label for="companyLogo">Company Logo</label>
                            <div class="logo-upload-area">
                                <img src="${state.companyInfo.logo || ''}" alt="Logo Preview" id="logo-preview" class="logo-preview">
                                <input type="file" id="companyLogo" name="companyLogo" accept="image/*">
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="companyAddress">Address</label>
                            <input type="text" id="companyAddress" name="companyAddress" value="${state.companyInfo.address}">
                        </div>
                         <div class="form-group">
                            <label for="personInCharge">Person In Charge</label>
                            <input type="text" id="personInCharge" name="personInCharge" value="${state.companyInfo.personInCharge}">
                        </div>
                         <div class="form-group">
                            <label for="contactNumber">Contact Number</label>
                            <input type="tel" id="contactNumber" name="contactNumber" value="${state.companyInfo.contactNumber}">
                        </div>
                         <div class="form-group">
                            <label for="welcomeMessage">Welcome Message</label>
                            <input type="text" id="welcomeMessage" name="welcomeMessage" value="${state.companyInfo.welcomeMessage}">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" id="cancel-company-setup-btn">Cancel</button>
                        <button type="submit" class="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderUserRoleModal() {
    if (!state.isUserRoleModalOpen) return '';

    const { users, currentUser } = state;
    const adminCount = users.filter(u => u.role === 'Admin').length;

    return `
        <div class="modal-overlay visible">
            <div class="modal-content standard">
                <div class="modal-header">
                    <h3>Manage User Roles</h3>
                    <button class="close-button" id="close-user-role-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <ul class="user-role-list">
                        ${users.map(user => {
                            const isSelf = currentUser?.id === user.id;
                            const canChangeRole = !(isSelf && adminCount <= 1);
                            return `
                                <li class="user-role-item" data-user-id="${user.id}">
                                    <span>${user.username}</span>
                                    <div class="user-role-actions">
                                        <select class="role-select" data-userid="${user.id}" ${canChangeRole ? '' : 'disabled'}>
                                            <option value="Admin" ${user.role === 'Admin' ? 'selected' : ''}>Admin</option>
                                            <option value="Security" ${user.role === 'Security' ? 'selected' : ''}>Security</option>
                                            <option value="Officer" ${user.role === 'Officer' ? 'selected' : ''}>Officer</option>
                                            <option value="Resident" ${user.role === 'Resident' ? 'selected' : ''}>Resident</option>
                                        </select>
                                        <button class="btn btn-secondary btn-small edit-user-btn" data-userid="${user.id}">Edit</button>
                                        <button class="btn btn-danger btn-small delete-user-btn" data-userid="${user.id}">Delete</button>
                                    </div>
                                </li>
                            `
                        }).join('')}
                    </ul>
                </div>
            </div>
        </div>
    `;
}

function renderEditUserModal() {
    if (!state.isEditUserModalOpen || state.editingUserId === null) return '';

    const user = state.users.find(u => u.id === state.editingUserId);
    if (!user) return '';

    return `
         <div class="modal-overlay visible">
            <div class="modal-content small">
                <div class="modal-header">
                    <h3>Edit User: ${user.username}</h3>
                    <button class="close-button" id="close-edit-user-btn">&times;</button>
                </div>
                <form id="edit-user-form">
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="username">Username</label>
                            <input type="text" id="username" name="username" value="${user.username}" required>
                        </div>
                        <div class="form-group">
                            <label for="newPassword">New Password (optional)</label>
                            <input type="password" id="newPassword" name="newPassword" placeholder="Leave blank to keep current password">
                        </div>
                        <div class="form-group">
                            <label for="confirmPassword">Confirm New Password</label>
                            <input type="password" id="confirmPassword" name="confirmPassword">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" id="cancel-edit-user-btn">Cancel</button>
                        <button type="submit" class="btn btn-primary">Save Changes</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderApprovalModal() {
    if (!state.isApprovalModalOpen) return '';

    const pendingVisitors = state.visitors.filter(v => v.status === 'Pending');
    if (pendingVisitors.length === 0) return '';

    return `
        <div class="modal-overlay visible">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Pending Visitor Approvals</h3>
                    <button class="close-button" id="close-approval-modal-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <p>The following visitors are awaiting approval. You can approve or reject them now.</p>
                    <ul class="pending-approval-list">
                        ${pendingVisitors.map(visitor => `
                            <li class="pending-approval-item">
                                <div class="pending-approval-info">
                                    <strong>${visitor.name}</strong>
                                    <span>To visit: ${visitor.resident}</span>
                                    <small>Purpose: ${visitor.purpose}</small>
                                </div>
                                <div class="pending-approval-actions">
                                    <button class="btn btn-success btn-small" data-action="approve" data-visitor-id="${visitor.id}">Approve</button>
                                    <button class="btn btn-danger btn-small" data-action="reject" data-visitor-id="${visitor.id}">Reject</button>
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" id="review-later-btn">Review Later</button>
                </div>
            </div>
        </div>
    `;
}

function renderChatNotificationModal() {
    if (!state.isChatNotificationModalOpen) return '';

    const pendingChats = state.pendingChats.filter(c => !c.dismissed);
    if (pendingChats.length === 0) return '';

    return `
        <div class="modal-overlay visible">
            <div class="modal-content standard">
                <div class="modal-header">
                    <h3>Pending User Chats</h3>
                    <button class="close-button" id="close-chat-notification-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <p>The following users have started a chat and may need assistance.</p>
                    <ul class="pending-chat-list">
                        ${pendingChats.map(chat => `
                            <li class="pending-chat-item">
                                <div class="pending-chat-info">
                                    <strong>${chat.userName} (${chat.unit})</strong>
                                    <small>Query: "${chat.initialQuery}"</small>
                                </div>
                                <div class="pending-chat-actions">
                                    <button class="btn btn-primary btn-small" data-action="reply-chat" data-chat-id="${chat.id}">Reply Now</button>
                                    <button class="btn btn-secondary btn-small" data-action="dismiss-chat" data-chat-id="${chat.id}">Dismiss</button>
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" id="close-chat-notification-btn-footer">Close</button>
                </div>
            </div>
        </div>
    `;
}

function renderUnitManagementModal() {
    if (!state.isUnitManagementModalOpen) return '';

    const groupedUnits = state.predefinedUnits.reduce((acc, unit) => {
        if (!acc[unit.block]) {
            acc[unit.block] = [];
        }
        acc[unit.block].push(unit);
        return acc;
    }, {} as Record<string, PredefinedUnit[]>);

    const sortedBlocks = Object.keys(groupedUnits).sort();

    return `
        <div class="modal-overlay visible">
            <div class="modal-content standard">
                <div class="modal-header">
                    <h3>Manage Predefined Units</h3>
                    <button class="close-button" id="close-unit-management-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="add-unit-form-container card">
                        <h4>Add New Unit</h4>
                        <form id="add-unit-form">
                            <div class="form-group-row">
                                <div class="form-group">
                                    <label for="newUnitBlock">Block</label>
                                    <input type="text" id="newUnitBlock" class="uppercase-input" placeholder="e.g., A" required>
                                </div>
                                <div class="form-group">
                                    <label for="newUnitHouseNo">House No.</label>
                                    <input type="text" id="newUnitHouseNo" placeholder="e.g., 101" required>
                                </div>
                                <button type="submit" class="btn btn-primary">Add</button>
                            </div>
                        </form>
                    </div>
                    
                    <div class="unit-list-container">
                        ${sortedBlocks.length > 0 ? sortedBlocks.map(block => `
                            <div class="unit-block-group">
                                <h5 class="unit-block-header">Block ${block}</h5>
                                <div class="unit-tags-container">
                                    ${groupedUnits[block].map(unit => `
                                        <div class="unit-tag">
                                            <span>${unit.block}-${unit.houseNo}</span>
                                            <button class="delete-unit-btn" data-block="${unit.block}" data-houseno="${unit.houseNo}" title="Delete unit">&times;</button>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('') : '<p class="no-data-message">No units defined. Add one above to get started.</p>'}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderOverviewView() {
    const totalVisitors = state.visitors.length;
    const checkedInCount = state.visitors.filter(v => v.status === 'Checked-in').length;
    const pendingCount = state.visitors.filter(v => v.status === 'Pending').length;
    const checkedOutToday = state.visitors.filter(v => v.status === 'Checked-out' && v.checkOutTime && new Date(v.checkOutTime).toDateString() === new Date().toDateString()).length;

    const purposeCounts = state.visitors.reduce((acc, v) => {
        acc[v.purpose] = (acc[v.purpose] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const sortedPurposes = Object.entries(purposeCounts).sort(([, a], [, b]) => b - a);

    const checkedInVisitors = state.visitors.filter(v => v.status === 'Checked-in');
    
    return `
        ${renderHeader()}
        <main class="main-content">
            <div class="visitors-header">
                <h2>System Overview</h2>
                <button id="dashboard-btn" class="btn btn-primary">Back to Dashboard</button>
            </div>

            <div class="stats-grid">
                <div class="stat-card" style="border-color: var(--info-color);">
                    <div class="stat-value">${totalVisitors}</div>
                    <div class="stat-label">Total Visitors (All Time)</div>
                </div>
                <div class="stat-card" style="border-color: var(--success-color);">
                    <div class="stat-value">${checkedInCount}</div>
                    <div class="stat-label">Currently Checked-in</div>
                </div>
                <div class="stat-card" style="border-color: var(--warning-color);">
                    <div class="stat-value">${pendingCount}</div>
                    <div class="stat-label">Pending Approval</div>
                </div>
                <div class="stat-card" style="border-color: var(--danger-color);">
                    <div class="stat-value">${checkedOutToday}</div>
                    <div class="stat-label">Checked-out Today</div>
                </div>
            </div>

            <div class="overview-panels">
                 <div class="card">
                    <h3>Currently Checked-in Visitors</h3>
                    <div class="checked-in-list">
                        ${checkedInVisitors.length > 0 ? checkedInVisitors.map(v => `
                            <div class="checked-in-item">
                                ${v.photo ? `<img src="${v.photo}" alt="${v.name}" class="visitor-avatar visitor-avatar-img">` : `<div class="visitor-avatar" style="background-color: ${getAvatarColor(v.name)};">${getInitials(v.name)}</div>`}
                                <div class="checked-in-info">
                                    <strong>${v.name}</strong>
                                    <small>Visiting ${v.resident}, since ${formatDateTime(v.checkInTime)}</small>
                                </div>
                            </div>
                        `).join('') : '<p class="no-data-message">No visitors are currently checked-in.</p>'}
                    </div>
                </div>

                <div class="card">
                    <h3>Visit Purpose Breakdown</h3>
                    <div class="purpose-breakdown-list">
                        ${sortedPurposes.length > 0 ? sortedPurposes.map(([purpose, count]) => `
                            <div class="purpose-item">
                                <div class="purpose-label">
                                    <span>${purpose}</span>
                                    <span>${count}</span>
                                </div>
                                <div class="progress-bar-container">
                                    <div class="progress-bar-fill" style="width: ${(count / totalVisitors) * 100}%;"></div>
                                </div>
                            </div>
                        `).join('') : '<p class="no-data-message">No visitor data to analyze.</p>'}
                    </div>
                </div>
            </div>
            
            <div class="card activity-log-panel">
                <h3>Recent Activity Log</h3>
                <div class="activity-log">
                    ${state.activityLog.length > 0 ? state.activityLog.map(activity => `
                        <div class="activity-item">
                            <span>${activity.message}</span>
                            <span class="activity-time">${formatTimeAgo(activity.timestamp)}</span>
                        </div>
                    `).join('') : '<p class="no-data-message">No recent activity.</p>'}
                </div>
            </div>
        </main>
    `;
}

function renderChatbot() {
    if (!state.isAuthenticated) return '';

    const fab = `
        <button id="chatbot-fab" class="chatbot-fab ${state.isChatOpen ? 'hidden' : ''}" aria-label="Open Chat">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6c-.55 0-1-.45-1-1s.45-1 1-1h12c.55 0 1 .45 1 1s-.45 1-1 1zm-4-4H6c-.55 0-1-.45-1-1s.45-1 1-1h8c.55 0 1 .45 1 1s-.45 1-1 1zm0-4H6c-.55 0-1-.45-1-1s.45-1 1-1h8c.55 0 1 .45 1 1s-.45 1-1 1z"/>
            </svg>
        </button>
    `;

    let chatContent = '';
    const isViewingAsAdmin = state.viewingChatId !== null && ['Admin', 'Officer'].includes(state.currentUser?.role || '');

    if (state.chatState === 'pre-form' && !isViewingAsAdmin) {
        let prefilledName = '';
        let prefilledBlock = '';
        let prefilledHouseNo = '';

        if (state.currentUser?.role === 'Resident' && state.currentUser.unitNo) {
            prefilledName = state.currentUser.username;
            const unitParts = state.currentUser.unitNo.split('-');
            if (unitParts.length === 2) {
                prefilledBlock = unitParts[0];
                prefilledHouseNo = unitParts[1];
            }
        }

        const blockOptions = [...new Set(state.predefinedUnits.map(u => u.block))].sort();
        const houseNoOptionsHTML = getHouseNoOptionsHTML(prefilledBlock, prefilledHouseNo);

        chatContent = `
            <div class="chat-body">
                <form id="start-chat-form">
                    <p style="text-align: center; margin-bottom: 1rem; color: var(--text-color-secondary);">Please confirm your details to start chatting with ResiBot.</p>
                    <div class="form-group">
                        <label for="chat-name">Your Name</label>
                        <input type="text" id="chat-name" name="chat-name" required value="${prefilledName}">
                    </div>
                    <div class="form-group-row">
                        <div class="form-group">
                            <label for="chat-block">Block</label>
                            <select id="chat-block" name="chat-block" required>
                                <option value="">-- Select Block --</option>
                                ${blockOptions.map(b => `<option value="${b}" ${b === prefilledBlock ? 'selected' : ''}>${b}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="chat-houseNo">House No.</label>
                            <select id="chat-houseNo" name="chat-houseNo" required ${!prefilledBlock ? 'disabled' : ''}>
                                ${houseNoOptionsHTML}
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="chat-initial-query">How can I help you today?</label>
                        <textarea id="chat-initial-query" name="chat-initial-query" rows="3" required placeholder="e.g., Is my guest here?"></textarea>
                    </div>
                    <div style="padding-top: 0.5rem;">
                        <button type="submit" class="btn btn-primary btn-full-width">Start Chat</button>
                    </div>
                </form>
            </div>
        `;
    } else {
        const messagesToShow = state.chatMessages;
        const activeChat = state.pendingChats.find(c => c.id === state.activeChatId || c.id === state.viewingChatId);
        const isLockedForUser = state.currentUser?.role === 'Resident' && activeChat?.adminReplied;

        let footerHTML = '';

        if (isViewingAsAdmin) {
            footerHTML = `
                <form id="admin-chat-form">
                    <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off" required>
                    <button type="submit" class="btn-send" aria-label="Send">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </button>
                </form>
            `;
        } else if (isLockedForUser) {
            footerHTML = `
                <div class="chat-footer-locked">
                    An admin has replied. This chat is now read-only.
                </div>
            `;
        } else {
            footerHTML = `
                <form id="user-chat-form">
                    <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off" required>
                    <button type="submit" class="btn-send" aria-label="Send">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </button>
                </form>
            `;
        }

        chatContent = `
            <div class="chat-body" id="chat-body-messages">
                ${messagesToShow.map(msg => `
                    <div class="message ${msg.sender}">
                         <div class="message-sender-label">${msg.sender}</div>
                        <div class="message-text">${msg.text.replace(/\n/g, '<br>')}</div>
                    </div>
                `).join('')}
                ${state.isBotTyping && !isViewingAsAdmin ? `
                    <div class="message bot">
                         <div class="message-sender-label">bot</div>
                        <div class="message-text typing-indicator">
                            <span></span><span></span><span></span>
                        </div>
                    </div>
                ` : ''}
            </div>
            <div class="chat-footer">
                ${footerHTML}
            </div>
        `;
    }
    
    const chatWindow = `
        <div class="chat-window ${state.isChatOpen ? 'open' : ''}">
            <div class="chat-header">
                <h3>${isViewingAsAdmin ? `Replying to ${state.pendingChats.find(c=>c.id === state.viewingChatId)?.userName || 'User'}` : 'ResiBot Assistant'}</h3>
                <button class="close-button" id="close-chat-btn">&times;</button>
            </div>
            ${chatContent}
        </div>
    `;

    return fab + chatWindow;
}


function renderGridOnly() {
    const gridContainer = document.getElementById('visitor-grid-container');
    if (gridContainer) {
        gridContainer.innerHTML = renderVisitorsGrid();
        attachGridEventListeners();
    }
}

function render() {
    const app = document.getElementById('app');
    if (!app) return;

    if (state.isLoadingData) {
        app.innerHTML = `<div class="loading-overlay"><div class="spinner"></div></div>`;
        return;
    }

    let viewHtml = '';
    if (!state.isAuthenticated || !state.currentUser) {
        viewHtml = renderLoginPage();
    } else {
        switch (state.currentView) {
            case 'dashboard':
                viewHtml = renderDashboardView();
                break;
            case 'overview':
                viewHtml = renderOverviewView();
                break;
            default:
                viewHtml = renderDashboardView();
        }
    }
    
    app.innerHTML = `
        <div class="app-container">
            ${viewHtml}
        </div>
        ${state.isAuthenticated ? renderChatbot() : ''}
        ${renderVisitorFormModal()}
        ${renderCompanySetupModal()}
        ${renderUserRoleModal()}
        ${renderEditUserModal()}
        ${renderUnitManagementModal()}
        ${renderApprovalModal()}
        ${renderChatNotificationModal()}
    `;
    
    attachEventListeners();
}

function attachGridEventListeners() {
    const grid = document.querySelector('.visitor-grid');
    if (grid) {
        grid.addEventListener('click', (event) => {
            const button = (event.target as HTMLElement).closest('button');
            if (!button) return;

            const { action, visitorId } = button.dataset;
            const id = parseInt(visitorId || '', 10);
            if (!id) return;
            
            if (action === 'approve') handleApprove(id);
            if (action === 'reject') handleReject(id);
            if (action === 'check-in') handleCheckIn(id);
            if (action === 'check-out') handleCheckOut(id);
            if (action === 'edit') handleEditClick(id);
        });
    }
}

function attachEventListeners() {
    // Login/Logout
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // Main Navigation
    const overviewBtn = document.getElementById('overview-btn');
    if (overviewBtn) overviewBtn.addEventListener('click', handleOverviewClick);
    const dashboardBtn = document.getElementById('dashboard-btn');
    if (dashboardBtn) dashboardBtn.addEventListener('click', handleDashboardClick);
    
    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', handleSearch);

    // Visitor Registration
    const registerVisitorBtn = document.getElementById('register-visitor-btn');
    if (registerVisitorBtn) registerVisitorBtn.addEventListener('click', handleRegisterClick);

    // Visitor Form Modal
    const visitorForm = document.getElementById('visitor-form');
    if (visitorForm) visitorForm.addEventListener('submit', handleFormSubmit);

    const closeModalBtn = document.getElementById('close-modal-btn');
    if (closeModalBtn) closeModalBtn.addEventListener('click', handleCloseModal);
    const cancelModalBtn = document.getElementById('cancel-modal-btn');
    if (cancelModalBtn) cancelModalBtn.addEventListener('click', handleCloseModal);
    
    const blockSelect = document.getElementById('block') as HTMLSelectElement;
    if (blockSelect) {
        blockSelect.addEventListener('change', () => {
            const houseNoSelect = document.getElementById('houseNo') as HTMLSelectElement;
            if (houseNoSelect) {
                const selectedBlock = blockSelect.value;
                houseNoSelect.innerHTML = getHouseNoOptionsHTML(selectedBlock);
                houseNoSelect.disabled = !selectedBlock;
            }
        });
    }

    // Camera
    const cameraActionBtn = document.getElementById('camera-action-btn');
    if (cameraActionBtn) cameraActionBtn.addEventListener('click', handleCameraAction);

    // Company Setup Modal
    const companySetupBtn = document.getElementById('company-setup-btn');
    if (companySetupBtn) companySetupBtn.addEventListener('click', handleCompanySetupClick);

    const closeCompanySetupBtn = document.getElementById('close-company-setup-btn');
    if (closeCompanySetupBtn) closeCompanySetupBtn.addEventListener('click', handleCloseCompanySetupModal);
    const cancelCompanySetupBtn = document.getElementById('cancel-company-setup-btn');
    if (cancelCompanySetupBtn) cancelCompanySetupBtn.addEventListener('click', handleCloseCompanySetupModal);
    
    const companySetupForm = document.getElementById('company-setup-form');
    if (companySetupForm) companySetupForm.addEventListener('submit', handleCompanySetupFormSubmit);
    
    const companyLogoInput = document.getElementById('companyLogo') as HTMLInputElement;
    if (companyLogoInput) {
        companyLogoInput.addEventListener('change', () => {
            const preview = document.getElementById('logo-preview') as HTMLImageElement;
            const file = companyLogoInput.files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = e => { preview.src = e.target?.result as string; };
                reader.readAsDataURL(file);
            }
        });
    }

    // User Role Modal
    const userRolesBtn = document.getElementById('user-roles-btn');
    if (userRolesBtn) userRolesBtn.addEventListener('click', handleUserRolesClick);
    const closeUserRoleBtn = document.getElementById('close-user-role-btn');
    if (closeUserRoleBtn) closeUserRoleBtn.addEventListener('click', handleCloseUserRoleModal);

    document.querySelectorAll('.role-select').forEach(sel => sel.addEventListener('change', handleRoleChange));
    document.querySelectorAll('.edit-user-btn').forEach(btn => btn.addEventListener('click', (e) => handleOpenEditUserModal(parseInt((e.currentTarget as HTMLElement).dataset.userid || ''))));
    document.querySelectorAll('.delete-user-btn').forEach(btn => btn.addEventListener('click', (e) => handleDeleteUser(parseInt((e.currentTarget as HTMLElement).dataset.userid || ''))));


    // Edit User Modal
    const editUserForm = document.getElementById('edit-user-form');
    if (editUserForm) editUserForm.addEventListener('submit', handleEditUserFormSubmit);
    const closeEditUserBtn = document.getElementById('close-edit-user-btn');
    if(closeEditUserBtn) closeEditUserBtn.addEventListener('click', handleCloseEditUserModal);
    const cancelEditUserBtn = document.getElementById('cancel-edit-user-btn');
    if(cancelEditUserBtn) cancelEditUserBtn.addEventListener('click', handleCloseEditUserModal);

    // Unit Management Modal
    const unitManagementBtn = document.getElementById('unit-management-btn');
    if (unitManagementBtn) unitManagementBtn.addEventListener('click', handleManageUnitsClick);
    const closeUnitManagementBtn = document.getElementById('close-unit-management-btn');
    if (closeUnitManagementBtn) closeUnitManagementBtn.addEventListener('click', handleCloseUnitManagementModal);

    const addUnitForm = document.getElementById('add-unit-form');
    if (addUnitForm) addUnitForm.addEventListener('submit', handleAddUnitSubmit);
    
    document.querySelectorAll('.delete-unit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement;
            handleDeleteUnit(target.dataset.block || '', target.dataset.houseno || '');
        });
    });

    // Approval Modal
    const closeApprovalBtn = document.getElementById('close-approval-modal-btn');
    if (closeApprovalBtn) closeApprovalBtn.addEventListener('click', handleCloseApprovalModal);
    const reviewLaterBtn = document.getElementById('review-later-btn');
    if (reviewLaterBtn) reviewLaterBtn.addEventListener('click', handleCloseApprovalModal);
    
    const approvalList = document.querySelector('.pending-approval-list');
    if(approvalList) {
        approvalList.addEventListener('click', (event) => {
            const button = (event.target as HTMLElement).closest('button');
            if (!button) return;
            const { action, visitorId } = button.dataset;
            const id = parseInt(visitorId || '', 10);
            if (!id) return;
            if (action === 'approve') handleApprove(id);
            if (action === 'reject') handleReject(id);
        });
    }

    // Chatbot listeners
    const chatFab = document.getElementById('chatbot-fab');
    if (chatFab) chatFab.addEventListener('click', handleToggleChat);

    const closeChatBtn = document.getElementById('close-chat-btn');
    if (closeChatBtn) closeChatBtn.addEventListener('click', handleToggleChat);

    const startChatForm = document.getElementById('start-chat-form');
    if (startChatForm) startChatForm.addEventListener('submit', handleStartChatSubmit);
    
    const userChatForm = document.getElementById('user-chat-form');
    if (userChatForm) userChatForm.addEventListener('submit', handleUserChatSubmit);
    
    const adminChatForm = document.getElementById('admin-chat-form');
    if (adminChatForm) adminChatForm.addEventListener('submit', handleAdminChatSubmit);

    const chatBlockSelect = document.getElementById('chat-block') as HTMLSelectElement;
    if (chatBlockSelect) {
        chatBlockSelect.addEventListener('change', () => {
            const houseNoSelect = document.getElementById('chat-houseNo') as HTMLSelectElement;
            if (houseNoSelect) {
                const selectedBlock = chatBlockSelect.value;
                houseNoSelect.innerHTML = getHouseNoOptionsHTML(selectedBlock);
                houseNoSelect.disabled = !selectedBlock;
            }
        });
    }
    
    // Chat notification modal listeners
    const closeChatNotificationBtn = document.getElementById('close-chat-notification-btn');
    if (closeChatNotificationBtn) closeChatNotificationBtn.addEventListener('click', handleCloseChatNotificationModal);
    const closeChatNotificationFooterBtn = document.getElementById('close-chat-notification-btn-footer');
    if(closeChatNotificationFooterBtn) closeChatNotificationFooterBtn.addEventListener('click', handleCloseChatNotificationModal);

    const pendingChatList = document.querySelector('.pending-chat-list');
    if (pendingChatList) {
        pendingChatList.addEventListener('click', (event) => {
            const button = (event.target as HTMLElement).closest('button');
            if (!button) return;
            const { action, chatId } = button.dataset;
            const id = parseInt(chatId || '', 10);
            if (!id) return;
            if (action === 'reply-chat') handleReplyToChat(id);
            if (action === 'dismiss-chat') handleDismissChat(id);
        });
    }

    if(state.isChatOpen && state.chatState === 'chatting') {
        const chatBody = document.getElementById('chat-body-messages');
        if (chatBody) {
            chatBody.scrollTop = chatBody.scrollHeight;
        }
    }


    attachGridEventListeners();
}

function init() {
    let finalStateUpdate: Partial<typeof state>;
    try {
        const savedDataJSON = localStorage.getItem('resiGuardData');
        const data = savedDataJSON ? JSON.parse(savedDataJSON) : null;

        finalStateUpdate = {
            visitors: data?.visitors ?? mockVisitors,
            users: data?.users ?? mockUsers,
            companyInfo: data?.companyInfo ?? defaultCompanyInfo,
            predefinedUnits: data?.predefinedUnits ?? mockUnits,
            pendingChats: data?.pendingChats ?? [],
            sessions: data?.sessions ?? {},
        };
    } catch (error) {
        console.error("Could not load or parse saved data, using mocks.", error);
        finalStateUpdate = {
            visitors: mockVisitors,
            users: mockUsers,
            companyInfo: defaultCompanyInfo,
            predefinedUnits: mockUnits,
            pendingChats: [],
            sessions: {},
        };
    }

    const tempState = { ...state, ...finalStateUpdate };
    const sessionId = sessionStorage.getItem('sessionId');
    const userId = sessionId ? tempState.sessions[sessionId] : null;
    const user = userId ? tempState.users.find(u => u.id === userId) : null;

    if (user) {
        const pendingVisitorsExist = tempState.visitors.some(v => v.status === 'Pending');
        const shouldShowApprovalModal = ['Admin', 'Officer'].includes(user.role) && pendingVisitorsExist;
        const pendingChatsExist = tempState.pendingChats.some(c => !c.dismissed);
        const shouldShowChatModal = ['Admin', 'Officer'].includes(user.role) && pendingChatsExist;
        let userActiveChatId: number | null = null;
        if (user.role === 'Resident') {
            const theirChats = tempState.pendingChats
                .filter(c => c.userId === user.id && !c.adminReplied && !c.dismissed)
                .sort((a, b) => b.id - a.id);
            if (theirChats.length > 0) {
                userActiveChatId = theirChats[0].id;
                sessionStorage.setItem('activeChatId', userActiveChatId.toString());
            }
        }
        
        finalStateUpdate = {
            ...finalStateUpdate,
            isAuthenticated: true,
            currentView: 'dashboard',
            currentUser: user,
            loginError: '',
            isApprovalModalOpen: shouldShowApprovalModal,
            isChatNotificationModalOpen: shouldShowChatModal,
            activeChatId: userActiveChatId,
        };
    } else if (sessionId) {
        sessionStorage.removeItem('sessionId');
    }
    
    setState({ ...finalStateUpdate, isLoadingData: false });
}

// Initial load
init();