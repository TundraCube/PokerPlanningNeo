import { Injectable, inject, signal, effect, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, doc, docData, setDoc, updateDoc, arrayUnion, arrayRemove, deleteField, getDoc, runTransaction } from '@angular/fire/firestore';
import { Auth, signInAnonymously, user, User } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { Observable, Subscription, of } from 'rxjs';
import { switchMap, tap, map } from 'rxjs/operators';

export interface Player {
    id: string;
    name: string;
    status: 'Voted' | 'Waiting...' | 'Not Participating' | 'Disconnected';
    vote?: string | null;
    avatarUrl?: string;
}

export interface Task {
    id: string;
    description: string;
    finalEstimate?: string;
    createdAt: number;
    // Jira Integration metadata
    jiraKey?: string;
    jiraSummary?: string;
    jiraUrl?: string;
    jiraSyncStatus?: 'pending' | 'synced' | 'failed';
    jiraSyncError?: string;
}

export interface Room {
    hostId: string;
    hostIds?: string[];
    areCardsRevealed: boolean;
    players: Player[];
    roomName?: string;
    currentStory?: string;
    currentTaskId?: string | null;
    createdAt?: number;
    lastActiveAt?: number;
    currentPlayerId?: string;
    status?: 'active' | 'ended';
    tasks?: Task[];
    timerEndsAt?: number | null;
    isPersistent?: boolean;
    jiraCustomDomain?: string;
}

const STORAGE_KEY = 'POKER_USER_NAME';

@Injectable({
    providedIn: 'root'
})
export class GameService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private router = inject(Router);
    private injector = inject(Injector);

    currentUser = signal<User | null>(null);
    currentRoomId = signal<string | null>(null);
    currentRoomData = signal<Room | null>(null);

    // Derived signals
    players = signal<Player[]>([]);
    isHost = signal<boolean>(false);
    areCardsRevealed = signal<boolean>(false);

    private roomSubscription?: Subscription;

    constructor() {
        console.log('GameService initialized');
        // Monitor Auth State
        this.runInContext(() => user(this.auth)).subscribe(user => {
            console.log('Auth state changed:', user ? 'User logged in' : 'No user');
            this.currentUser.set(user);
            if (!user) {
                console.log('No user, attempting anonymous sign-in...');
                this.runInContext(() => {
                    signInAnonymously(this.auth).then(() => {
                        console.log('Anonymous sign-in successful');
                    }).catch(error => {
                        console.error('Anonymous sign-in failed:', error);
                    });
                });
            }
        });

        // Effect to update derived signals when room data changes
        effect(() => {
            const roomData = this.currentRoomData();
            const user = this.currentUser();

            if (roomData) {
                this.players.set(roomData.players || []);
                this.areCardsRevealed.set(roomData.areCardsRevealed);
                if (user) {
                    const isUserHost = roomData.hostId === user.uid || (roomData.hostIds && roomData.hostIds.includes(user.uid));
                    this.isHost.set(!!isUserHost);
                }
            } else {
                this.players.set([]);
                this.isHost.set(false);
                this.areCardsRevealed.set(false);
            }
        });
    }

    private runInContext<T>(fn: () => T): T {
        return runInInjectionContext(this.injector, fn);
    }

    async createRoom(userName: string) {
        console.log('createRoom called with:', userName);
        localStorage.setItem(STORAGE_KEY, userName);

        try {
            let user = this.currentUser();
            if (!user) {
                console.log('User not logged in, waiting for auth...');
                const credential = await this.runInContext(() => signInAnonymously(this.auth));
                user = credential.user;
                console.log('Signed in (explicitly).');
            }

            if (!user) {
                console.error('Authentication failed: currentUser is null after sign-in attempt');
                throw new Error('Authentication failed');
            }

            const roomId = this.generateRoomId();
            console.log('Generated Room ID:', roomId);
            const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));

            const hostPlayer: Player = {
                id: user.uid,
                name: userName,
                status: 'Waiting...',
                vote: null
            };

            const now = Date.now();
            const cachedDomain = localStorage.getItem('POKER_JIRA_CUSTOM_DOMAIN');
            const newRoom: Room = {
                hostId: user.uid,
                areCardsRevealed: false,
                players: [hostPlayer],
                roomName: 'New Planning Session',
                currentStory: '',
                status: 'active',
                createdAt: now,
                lastActiveAt: now,
                ...(cachedDomain ? { jiraCustomDomain: cachedDomain } : {})
            };

            console.log('Setting document in Firestore...');
            await this.runInContext(() => setDoc(roomRef, newRoom));
            console.log('Document set. Joining room...');
            await this.joinRoom(roomId);
            return roomId;
        } catch (error) {
            console.error('Error in GameService.createRoom:', error);
            throw error;
        }
    }

    async joinRoom(roomId: string, userName?: string) {
        let user = this.currentUser();
        if (!user) {
            const credential = await this.runInContext(() => signInAnonymously(this.auth));
            user = credential.user;
        }

        if (!user) throw new Error('Authentication failed');

        this.currentRoomId.set(roomId);

        // Persist name if provided
        if (userName) {
            localStorage.setItem(STORAGE_KEY, userName);
        }

        // Subscribe to room updates
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        this.roomSubscription?.unsubscribe();

        this.roomSubscription = this.runInContext(() => docData(roomRef)).subscribe((data: any) => {
            if (data) {
                this.currentRoomData.set(data as Room);
            } else {
                // Room might have been deleted or doesn't exist
                this.currentRoomData.set(null);
            }
        });

        // Add or Update player in the room
        if (userName) {
            try {
                await this.runInContext(() => runTransaction(this.firestore, async (transaction) => {
                    const roomSnap = await transaction.get(roomRef);
                    if (roomSnap.exists()) {
                        const roomData = roomSnap.data() as Room;
                        const existingPlayer = roomData.players.find(p => p.id === user!.uid);
                        let updatedPlayers: Player[];

                        if (existingPlayer) {
                            updatedPlayers = roomData.players.map(p => {
                                if (p.id === user!.uid) {
                                    return { ...p, name: userName, status: 'Waiting...' as const };
                                }
                                return p;
                            });
                        } else {
                            const newPlayer: Player = {
                                id: user!.uid,
                                name: userName,
                                status: 'Waiting...',
                                vote: null
                            };
                            updatedPlayers = [...roomData.players, newPlayer];
                        }

                        transaction.update(roomRef, {
                            players: updatedPlayers,
                            lastActiveAt: Date.now()
                        });
                    }
                }));
            } catch (error) {
                console.error('Transaction failed in joinRoom:', error);
            }
        }
    }

    async leaveRoom(roomId: string, userId: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        try {
            await this.runInContext(() => runTransaction(this.firestore, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (roomSnap.exists()) {
                    const roomData = roomSnap.data() as Room;
                    const updatedPlayers = roomData.players.filter(p => p.id !== userId);
                    transaction.update(roomRef, {
                        players: updatedPlayers,
                        lastActiveAt: Date.now()
                    });
                }
            }));
            // Clear local state
            this.currentRoomId.set(null);
            this.currentRoomData.set(null);
            this.roomSubscription?.unsubscribe();
        } catch (error) {
            console.error('Transaction failed in leaveRoom:', error);
        }
    }

    cleanupLocalGameState() {
        this.roomSubscription?.unsubscribe();
        this.currentRoomId.set(null);
        this.currentRoomData.set(null);
    }

    async setPlayerStatus(roomId: string, userId: string, status: Player['status']) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        try {
            await this.runInContext(() => runTransaction(this.firestore, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (roomSnap.exists()) {
                    const roomData = roomSnap.data() as Room;
                    const updatedPlayers = roomData.players.map(p => {
                        if (p.id === userId) {
                            return { ...p, status };
                        }
                        return p;
                    });
                    transaction.update(roomRef, {
                        players: updatedPlayers,
                        lastActiveAt: Date.now()
                    });
                }
            }));
        } catch (error) {
            console.error('Transaction failed in setPlayerStatus:', error);
        }
    }

    async updatePlayerName(roomId: string, userId: string, newName: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        try {
            await this.runInContext(() => runTransaction(this.firestore, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (roomSnap.exists()) {
                    const roomData = roomSnap.data() as Room;
                    const updatedPlayers = roomData.players.map(p => {
                        if (p.id === userId) {
                            return { ...p, name: newName };
                        }
                        return p;
                    });
                    transaction.update(roomRef, {
                        players: updatedPlayers,
                        lastActiveAt: Date.now()
                    });
                }
            }));
            localStorage.setItem(STORAGE_KEY, newName);
        } catch (error) {
            console.error('Transaction failed in updatePlayerName:', error);
        }
    }

    async updateRoomName(roomId: string, name: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        await this.runInContext(() => updateDoc(roomRef, {
            roomName: name,
            lastActiveAt: Date.now()
        }));
    }

    async updateRoomPersistence(roomId: string, isPersistent: boolean) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        await this.runInContext(() => updateDoc(roomRef, {
            isPersistent,
            lastActiveAt: Date.now()
        }));
    }

    async updateRoomJiraCustomDomain(roomId: string, domain: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        await this.runInContext(() => updateDoc(roomRef, {
            jiraCustomDomain: domain.trim(),
            lastActiveAt: Date.now()
        }));
    }

    async updateCurrentStory(roomId: string, story: string, taskId?: string | null) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        await this.runInContext(() => updateDoc(roomRef, {
            currentStory: story,
            currentTaskId: taskId !== undefined ? taskId : null,
            lastActiveAt: Date.now()
        }));
    }

    async endSession(roomId: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        await this.runInContext(() => updateDoc(roomRef, {
            status: 'ended',
            players: [], // Remove all players
            lastActiveAt: Date.now()
        }));
    }

    private async addPlayerToRoom(roomId: string, player: Player) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        await this.runInContext(() => updateDoc(roomRef, {
            players: arrayUnion(player),
            lastActiveAt: Date.now()
        }));
    }

    async vote(voteValue: string) {
        const roomId = this.currentRoomId();
        const user = this.currentUser();

        if (!roomId || !user) return;

        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));

        try {
            await this.runInContext(() => runTransaction(this.firestore, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (roomSnap.exists()) {
                    const roomData = roomSnap.data() as Room;
                    const updatedPlayers = roomData.players.map(p => {
                        if (p.id === user.uid) {
                            return { ...p, vote: voteValue, status: 'Voted' as const };
                        }
                        return p;
                    });
                    transaction.update(roomRef, {
                        players: updatedPlayers,
                        lastActiveAt: Date.now()
                    });
                }
            }));
        } catch (error) {
            console.error('Transaction failed in vote:', error);
        }
    }

    async revealCards(reveal: boolean) {
        const roomId = this.currentRoomId();
        if (!roomId) return;
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        await this.runInContext(() => updateDoc(roomRef, {
            areCardsRevealed: reveal,
            lastActiveAt: Date.now()
        }));
    }

    async resetVotes() {
        const roomId = this.currentRoomId();
        if (!roomId) return;

        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));

        try {
            await this.runInContext(() => runTransaction(this.firestore, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (roomSnap.exists()) {
                    const roomData = roomSnap.data() as Room;
                    const updatedPlayers = roomData.players.map(p => ({
                        ...p,
                        vote: null,
                        status: 'Waiting...' as const
                    }));
                    transaction.update(roomRef, {
                        players: updatedPlayers,
                        areCardsRevealed: false,
                        lastActiveAt: Date.now()
                    });
                }
            }));
        } catch (error) {
            console.error('Transaction failed in resetVotes:', error);
        }
    }

    async addMockPlayer(roomId: string, name: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        try {
            let mockId = '';
            await this.runInContext(() => runTransaction(this.firestore, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (roomSnap.exists()) {
                    const roomData = roomSnap.data() as Room;
                    mockId = 'mock-' + Math.random().toString(36).substring(2, 9);
                    const player: Player = {
                        id: mockId,
                        name: name,
                        status: 'Waiting...',
                        vote: null
                    };
                    const updatedPlayers = [...(roomData.players || []), player];
                    transaction.update(roomRef, {
                        players: updatedPlayers,
                        lastActiveAt: Date.now()
                    });
                } else {
                    throw new Error('Room not found');
                }
            }));
            return mockId;
        } catch (error) {
            console.error('Transaction failed in addMockPlayer:', error);
            throw error;
        }
    }

    async removeMockPlayer(roomId: string, mockId: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        try {
            await this.runInContext(() => runTransaction(this.firestore, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (roomSnap.exists()) {
                    const roomData = roomSnap.data() as Room;
                    const updatedPlayers = roomData.players.filter(p => p.id !== mockId);
                    transaction.update(roomRef, {
                        players: updatedPlayers,
                        lastActiveAt: Date.now()
                    });
                }
            }));
        } catch (error) {
            console.error('Transaction failed in removeMockPlayer:', error);
        }
    }

    async submitMockVote(roomId: string, mockId: string, vote: string | null) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        try {
            await this.runInContext(() => runTransaction(this.firestore, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (roomSnap.exists()) {
                    const roomData = roomSnap.data() as Room;
                    const updatedPlayers = roomData.players.map(p => {
                        if (p.id === mockId) {
                            return { ...p, vote, status: vote ? 'Ready!' as const : 'Waiting...' as const };
                        }
                        return p;
                    });
                    transaction.update(roomRef, {
                        players: updatedPlayers,
                        lastActiveAt: Date.now()
                    });
                }
            }));
        } catch (error) {
            console.error('Transaction failed in submitMockVote:', error);
        }
    }

    async promoteToHost(roomId: string, userId: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        const roomSnap = await this.runInContext(() => getDoc(roomRef));
        if (roomSnap.exists()) {
            const roomData = roomSnap.data() as Room;
            const currentHostIds = roomData.hostIds || [roomData.hostId];
            if (!currentHostIds.includes(userId)) {
                await this.runInContext(() => updateDoc(roomRef, {
                    hostIds: [...currentHostIds, userId],
                    lastActiveAt: Date.now()
                }));
            }
        }
    }

    async setTimer(roomId: string, durationSeconds: number | null) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        const timerEndsAt = durationSeconds ? Date.now() + durationSeconds * 1000 : null;
        await this.runInContext(() => updateDoc(roomRef, {
            timerEndsAt,
            lastActiveAt: Date.now()
        }));
    }

    async addTask(roomId: string, description: string, jiraMeta?: { jiraKey?: string; jiraSummary?: string; jiraUrl?: string }) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        const task: any = {
            id: Math.random().toString(36).substring(2, 9),
            description,
            createdAt: Date.now()
        };
        
        if (jiraMeta) {
            if (jiraMeta.jiraKey) task.jiraKey = jiraMeta.jiraKey;
            if (jiraMeta.jiraSummary) task.jiraSummary = jiraMeta.jiraSummary;
            if (jiraMeta.jiraUrl) task.jiraUrl = jiraMeta.jiraUrl;
            if (jiraMeta.jiraKey) task.jiraSyncStatus = 'pending';
        }
        
        await this.runInContext(() => updateDoc(roomRef, {
            tasks: arrayUnion(task),
            lastActiveAt: Date.now()
        }));
    }

    async updateTaskJiraSyncStatus(roomId: string, taskId: string, status: 'synced' | 'failed' | 'pending', error?: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        const roomSnap = await this.runInContext(() => getDoc(roomRef));
        if (roomSnap.exists()) {
            const roomData = roomSnap.data() as Room;
            const updatedTasks = (roomData.tasks || []).map(t => {
                if (t.id === taskId) {
                    const updatedTask = { ...t, jiraSyncStatus: status };
                    if (error) {
                        updatedTask.jiraSyncError = error;
                    } else {
                        delete updatedTask.jiraSyncError;
                    }
                    return updatedTask;
                }
                return t;
            });
            await this.runInContext(() => updateDoc(roomRef, {
                tasks: updatedTasks,
                lastActiveAt: Date.now()
            }));
        }
    }

    async updateTaskSummary(roomId: string, taskId: string, newSummary: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        const roomSnap = await this.runInContext(() => getDoc(roomRef));
        if (roomSnap.exists()) {
            const roomData = roomSnap.data() as Room;
            const updatedTasks = (roomData.tasks || []).map(t => {
                if (t.id === taskId && t.jiraKey) {
                    return { 
                        ...t, 
                        jiraSummary: newSummary, 
                        description: `${t.jiraKey}: ${newSummary}` 
                    };
                }
                return t;
            });
            await this.runInContext(() => updateDoc(roomRef, {
                tasks: updatedTasks,
                lastActiveAt: Date.now()
            }));
        }
    }

    async deleteTask(roomId: string, taskId: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        const roomSnap = await this.runInContext(() => getDoc(roomRef));
        if (roomSnap.exists()) {
            const roomData = roomSnap.data() as Room;
            const updatedTasks = (roomData.tasks || []).filter(t => t.id !== taskId);
            await this.runInContext(() => updateDoc(roomRef, {
                tasks: updatedTasks,
                lastActiveAt: Date.now()
            }));
        }
    }

    async reorderTasks(roomId: string, tasks: Task[]) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        await this.runInContext(() => updateDoc(roomRef, {
            tasks: tasks,
            lastActiveAt: Date.now()
        }));
    }

    async updateTaskEstimate(roomId: string, taskId: string, estimate: string) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        const roomSnap = await this.runInContext(() => getDoc(roomRef));
        if (roomSnap.exists()) {
            const roomData = roomSnap.data() as Room;
            const updatedTasks = (roomData.tasks || []).map(t => {
                if (t.id === taskId) {
                    return { ...t, finalEstimate: estimate };
                }
                return t;
            });
            await this.runInContext(() => updateDoc(roomRef, {
                tasks: updatedTasks,
                lastActiveAt: Date.now()
            }));
        }
    }

    async estimateNewTask(roomId: string, storyDescription: string, finalEstimate: string, taskId?: string | null) {
        const roomRef = this.runInContext(() => doc(this.firestore, 'rooms', roomId));
        try {
            await this.runInContext(() => runTransaction(this.firestore, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (roomSnap.exists()) {
                    const roomData = roomSnap.data() as Room;
                    
                    let updatedTasks = roomData.tasks || [];
                    if (storyDescription) {
                        // Find by ID first if taskId is provided
                        let existingIdx = -1;
                        if (taskId) {
                            existingIdx = updatedTasks.findIndex(t => t.id === taskId);
                        }
                        // Fallback to description lookup only if ID lookup failed
                        if (existingIdx === -1) {
                            existingIdx = updatedTasks.findIndex(t => t.description.trim() === storyDescription.trim());
                        }

                        if (existingIdx > -1) {
                            updatedTasks = updatedTasks.map((t, idx) => {
                                if (idx === existingIdx) {
                                    return { ...t, finalEstimate: finalEstimate || undefined };
                                }
                                return t;
                            });
                        } else {
                            const newTask: Task = {
                                id: taskId || Math.random().toString(36).substring(2, 9),
                                description: storyDescription,
                                finalEstimate: finalEstimate || undefined,
                                createdAt: Date.now()
                            };
                            updatedTasks = [...updatedTasks, newTask];
                        }
                    }

                    const updatedPlayers = roomData.players.map(p => ({
                        ...p,
                        vote: null,
                        status: 'Waiting...' as const
                    }));

                    transaction.update(roomRef, {
                        tasks: updatedTasks,
                        currentStory: '',
                        currentTaskId: null,
                        players: updatedPlayers,
                        areCardsRevealed: false,
                        timerEndsAt: null,
                        lastActiveAt: Date.now()
                    });
                }
            }));
        } catch (error) {
            console.error('Transaction failed in estimateNewTask:', error);
        }
    }

    private generateRoomId(): string {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }
}
