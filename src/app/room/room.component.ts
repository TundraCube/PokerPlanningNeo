import { Component, inject, OnInit, signal, effect, computed, OnDestroy, HostListener } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { GameService } from '../game.service';
import { ModalService } from '../services/modal.service';
import { ToastService } from '../services/toast.service';

import { TaskDescriptionComponent } from '../components/task-description/task-description.component';
import { RoomHeaderComponent } from '../components/room-header/room-header.component';
import { RoomSidebarComponent } from '../components/room-sidebar/room-sidebar.component';
import { TaskListComponent } from '../components/task-list/task-list.component';
import { VotingDeckComponent } from '../components/voting-deck/voting-deck.component';
import { PlayerEmulatorComponent } from '../components/player-emulator/player-emulator.component';
import { NamePromptComponent } from '../components/name-prompt/name-prompt.component';
import { SessionEndedComponent } from '../components/session-ended/session-ended.component';

@Component({
  selector: 'app-room',
  imports: [
    FormsModule,
    TaskDescriptionComponent,
    RoomHeaderComponent,
    RoomSidebarComponent,
    TaskListComponent,
    VotingDeckComponent,
    PlayerEmulatorComponent,
    NamePromptComponent,
    SessionEndedComponent
  ],
  template: `
    @if (isLoading()) {
      <div class="loading-container">
        <div class="loader"></div>
        <p>Connecting to Room...</p>
      </div>
    } @else {
      <div class="room-layout" [class.host-theme]="isHost()">
        <!-- Main Content Area -->
        <main class="room-main-content">
          <div class="main-content-inner">
            <neo-room-header [roomId]="roomId || ''" 
                            [isHost]="isHost()"
                            [roomName]="currentRoomName()"
                            [title]="areCardsRevealed() ? 'Revealed Results' : ''"
                            [isPersistent]="isPersistent()"
                            [jiraCustomDomain]="jiraCustomDomain()"
                            (roomNameChange)="onRoomNameChange($event)"
                            (nameBlur)="saveRoomName()"
                            (persistentChange)="onPersistentChange($event)"
                            (jiraDomainChange)="onJiraDomainChange($event)"
                            (endSession)="leaveRoom()" 
                            (copyLink)="copyInviteLink()">
            </neo-room-header>

            <neo-task-description 
                [isHost]="isHost()"
                [story]="currentStory()"
                [tasks]="currentRoomTasks()"
                [isFromList]="isCurrentStoryFromList()"
                (storyChange)="onStoryChange($event)"
                (storyBlur)="saveCurrentStory()">
            </neo-task-description>

            <div class="voting-and-tasks-container">
              <div class="voting-cards-column">
                <neo-voting-deck></neo-voting-deck>
              </div>

              <div class="tasks-column">
                <neo-task-list
                  [roomId]="roomId || ''"
                  [isHost]="isHost()"
                  [tasks]="currentRoomTasks()"
                  [currentStory]="currentStory()"
                  [currentTaskId]="currentTaskId()"
                  [jiraCustomDomain]="jiraCustomDomain()"
                  (selectTask)="selectTaskForEstimation($event)">
                </neo-task-list>
              </div>
            </div>

            @if (isHost()) {
              <neo-player-emulator></neo-player-emulator>
            }
          </div>
        </main>

        <!-- Right Column: Sidebar (Direct child of flex container) -->
        <neo-room-sidebar 
          [isHost]="isHost()" 
          [players]="sortedPlayers()" 
          [areCardsRevealed]="areCardsRevealed()"
          [hasVotes]="hasVotes()"
          [currentUserId]="currentUser()?.uid"
          [votingValues]="votingValues"
          [isFromList]="isCurrentStoryFromList()"
          [nextTaskName]="nextTask()?.description || null"
          [hasActiveTask]="!!currentStory()"
          [confirmedEstimate]="confirmedEstimate()"
          (confirmedEstimateChange)="confirmedEstimate.set($event)"
          (reveal)="onRevealVotes()"
          (replay)="replayRound()"
          (saveAndContinue)="saveAndContinue()"
          (skip)="skipTask()">
        </neo-room-sidebar>
      </div>
    }

    <!-- Name Prompt Modal -->
    @if (showNamePrompt()) {
      <neo-name-prompt [initialName]="nameInput()" (submitName)="nameInput.set($event); submitName()"></neo-name-prompt>
    }
    <!-- Session Ended Overlay -->
    @if (sessionEnded()) {
      <neo-session-ended (leave)="forceLeave()"></neo-session-ended>
    }
  `,
  styleUrl: './room.component.css'
})
export class RoomComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private gameService = inject(GameService);
  private modalService = inject(ModalService);
  private toastService = inject(ToastService);


  roomId: string | null = null;

  // Signals from Service
  players = this.gameService.players;
  isHost = this.gameService.isHost;
  currentUser = this.gameService.currentUser;
  areCardsRevealed = this.gameService.areCardsRevealed;

  currentRoomTasks = computed(() => this.gameService.currentRoomData()?.tasks || []);
  /** The task ID that is currently active for estimation (stored in Firestore) */
  currentTaskId = computed(() => this.gameService.currentRoomData()?.currentTaskId || null);
  isPersistent = computed(() => this.gameService.currentRoomData()?.isPersistent || false);
  jiraCustomDomain = computed(() => {
    return this.gameService.currentRoomData()?.jiraCustomDomain || localStorage.getItem('POKER_JIRA_CUSTOM_DOMAIN') || '';
  });
  hasVotes = computed(() => {
    return this.players().some(p => p.vote !== undefined && p.vote !== null);
  });

  // Local signals for editable fields
  currentRoomName = signal<string>('');
  currentStory = signal<string>('');

  // ── Estimation flow signals ──

  /** True when the current story text exactly matches a task in the list */
  isCurrentStoryFromList = computed(() => {
    const story = this.currentStory().trim();
    if (!story) return false;
    return this.currentRoomTasks().some(t => t.description.trim() === story);
  });

  /** Index of the currently active task within the sorted task list (by ID when available) */
  currentTaskIndex = computed(() => {
    const taskId = this.currentTaskId();
    const tasks = this.currentRoomTasks();
    if (taskId) {
      const idx = tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) return idx;
    }
    // fallback: match by description
    const story = this.currentStory().trim();
    if (!story) return -1;
    return tasks.findIndex(t => t.description.trim() === story);
  });

  /** The next task in the list that has not yet been estimated, or null if none */
  nextTask = computed(() => {
    const tasks = this.currentRoomTasks();
    const idx = this.currentTaskIndex();
    if (idx === -1) {
      // No active task from list – pick the first unestimated one
      return tasks.find(t => !t.finalEstimate) || null;
    }
    // Walk forward from the current task and find the next unestimated one
    for (let i = idx + 1; i < tasks.length; i++) {
      if (!tasks[i].finalEstimate) return tasks[i];
    }
    return null;
  });

  /** The host-confirmed estimate value (pre-filled with Fibonacci coercion when cards reveal) */
  confirmedEstimate = signal<string>('');

  /** Coerce an average to the nearest value available in the active deck (rounds up on tie) */
  getClosestVotingValue(avg: number): string {
    const numericOptions = this.votingValues
      .map(v => Number(v))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    if (numericOptions.length === 0) return String(Math.round(avg));

    let closest = numericOptions[0];
    let minDiff = Math.abs(avg - closest);
    for (let i = 1; i < numericOptions.length; i++) {
      const diff = Math.abs(avg - numericOptions[i]);
      // On exact tie, prefer the larger value (safety margin)
      if (diff < minDiff || (diff === minDiff && numericOptions[i] > closest)) {
        minDiff = diff;
        closest = numericOptions[i];
      }
    }
    return String(closest);
  }

  // Sorted Players (Current user first)
  sortedPlayers = computed(() => {
    const players = this.players();
    const user = this.currentUser();
    if (!user) return players;

    const myIndex = players.findIndex(p => p.id === user.uid);
    if (myIndex === -1) return players;

    // Create a new array with current user at the top
    const me = players[myIndex];
    const others = players.filter(p => p.id !== user.uid);
    return [me, ...others];
  });

  // Player View State
  votingValues = ['0', '1', '2', '3', '5', '8', '13', '21', '?', '☕'];

  // Name Prompt State
  showNamePrompt = signal(true);
  nameInput = signal('');

  // Loading State
  isLoading = signal(true);

  // Auto-Join State
  isAutoJoining = signal(false);

  constructor() {
    effect(() => {
      const roomData = this.gameService.currentRoomData();
      const user = this.currentUser();

      // We only stop loading when we have both user and roomData (if room exists).
      // Also prevent modal flash if we are deliberately leaving
      if (roomData) {
        // Sync Room Name and Story
        // Only update signal if it's different to avoid loops if we add two-way binding or cause re-renders
        // But since these are signals, setting same value is fine.
        // IMPORTANT: If user is editing, we might not want to overwrite their local state immediately from server 
        // if there's lag, but generally for this app, server wins or we rely on them not typing while someone else does (Host only).
        // Since only Host edits, and there's 1 host, we can safely sync from server.
        // Ideally we check if document is active element, but simple approach first.

        if (roomData.roomName !== undefined) {
          this.currentRoomName.set(roomData.roomName);
        }
        if (roomData.currentStory !== undefined) {
          this.currentStory.set(roomData.currentStory);
        }

        // Check for Session End
        if (roomData.status === 'ended' && !this.sessionEnded()) {
          // If I am host, I should have already left or triggered this. 
          // But if I am a player, or a host in another tab, trigger the end-game flow.
          // If I initiated the end (isLeaving=true), I ignore this update (likely component destroyed already).
          if (!this.isLeaving && !this.isHost()) {
            this.triggerSessionEndedSequence();
          }
          // If I am host and see 'ended', and haven't left yet (maybe another host ended it? unlikely in this logic but possible),
          // perform leave immediately.
          if (!this.isLeaving && this.isHost()) {
            this.leaveRoom();
          }
        }
      }

      if (user && roomData && !this.isLeaving) {
        const me = roomData.players.find(p => p.id === user.uid);

        if (me) {
          // User is in the room -> Done.
          this.isAutoJoining.set(false);
          this.showNamePrompt.set(false);
          this.isLoading.set(false);
        } else if (!this.isAutoJoining() && !this.sessionEnded()) { // Only show name prompt if session NOT ended
          // User NOT in room and NOT auto-joining -> Show Prompt.
          this.showNamePrompt.set(true);
          this.isLoading.set(false);
        }
        // If isAutoJoining() is true and !me, we STAY LOADING (waiting for write to reflect).
      }
    });
  }

  ngOnInit() {
    this.roomId = this.route.snapshot.paramMap.get('id');

    if (!this.roomId) {
      this.router.navigate(['/']);
      return;
    }

    // Prefill name from localStorage and Auto-Join
    const savedName = localStorage.getItem('POKER_USER_NAME');
    if (savedName) {
      this.nameInput.set(savedName);
    }

    // Attempt to join/rejoin
    if (!this.gameService.currentRoomId()) {
      if (savedName) {
        this.isAutoJoining.set(true); // Suppress modal, show loader

        // Fallback timeout in case auto-join stalls
        setTimeout(() => {
          if (this.isAutoJoining()) {
            console.warn('Auto-join timed out, showing prompt.');
            this.isAutoJoining.set(false);
            // Effect will pick this up: isAutoJoining false + !me -> show prompt.
          }
        }, 4000);
      }

      this.gameService.joinRoom(this.roomId, savedName || undefined)
        .catch(err => {
          console.error('Join room failed', err);
          this.isAutoJoining.set(false);
        });
    }
  }

  // Flag to handle manual leave vs page unload
  isLeaving = false;

  // Session End Logic
  sessionEnded = signal(false);

  async leaveRoom() {
    // Guard against multiple calls (e.g. double clicks or effect triggers)
    if (this.isLeaving) return;

    // Safety timeout to prevent getting stuck in loading state
    const loadingTimeout = setTimeout(() => {
      if (this.isLoading()) {
        console.warn('Leave room timed out, forcing navigation.');
        this.router.navigate(['/']);
      }
    }, 5000); // 5 seconds max

    // If Host, trigger End Session for everyone
    if (this.isHost()) {
      const roomState = this.gameService.currentRoomData();

      // If session is already ended, skip confirmation
      if (roomState?.status !== 'ended') {
        const confirmed = await this.modalService.confirm(
          'End Session',
          'Are you sure you want to end the session? This will disconnect all players.',
          'End Session',
          'Cancel'
        );
        if (confirmed) {
          this.isLeaving = true;
          this.isLoading.set(true);

          try {
            await this.gameService.endSession(this.roomId!);
            // Host has already cleared players. 
            // Just clean up local state and leave.
            this.gameService.cleanupLocalGameState();
            clearTimeout(loadingTimeout);
            this.router.navigate(['/']);
            return;
          } catch (e) {
            console.error('Failed to end session', e);
            // Continue to standard leave logic if endSession failed totally
          }
        } else {
          clearTimeout(loadingTimeout);
          return; // Cancelled
        }
      }

    }

    this.isLeaving = true;
    this.isLoading.set(true);

    if (this.roomId && this.currentUser()) {
      try {
        await this.gameService.leaveRoom(this.roomId, this.currentUser()!.uid);
      } catch (e) {
        console.error('Error leaving room', e);
      }
    }
    clearTimeout(loadingTimeout);
    this.router.navigate(['/']);
  }

  triggerSessionEndedSequence() {
    this.sessionEnded.set(true);
    this.showNamePrompt.set(false); // Ensure modal is gone
  }

  forceLeave() {
    this.isLeaving = true;
    this.router.navigate(['/']);
  }

  async submitName() {
    const name = this.nameInput();
    if (!name || !this.roomId) return;

    try {
      await this.gameService.joinRoom(this.roomId, name);
      this.showNamePrompt.set(false);
    } catch (error) {
      console.error('Error joining room with name:', error);
    }
  }

  selectVote(value: string) {
    // Optimistic updates handled by server latency or could add local override later.
    // For now, rely on server source of truth to ensure reset works perfectly.
    this.gameService.vote(value);
  }

  onRevealVotes() {
    // Coerce average to nearest deck value and pre-fill confirmedEstimate
    const votes = this.players()
      .map(p => p.vote)
      .filter(v => v !== undefined && v !== null && v !== '?' && v !== '☕')
      .map(v => Number(v))
      .filter(n => !isNaN(n));

    if (votes.length > 0) {
      const avg = votes.reduce((a, b) => a + b, 0) / votes.length;
      this.confirmedEstimate.set(this.getClosestVotingValue(avg));
    } else {
      this.confirmedEstimate.set('');
    }

    this.gameService.revealCards(true);
  }

  revealVotes() {
    this.gameService.revealCards(true);
  }

  startNewRound() {
    this.gameService.resetVotes();
    // selectedValue auto-updates via computed
  }

  replayRound() {
    this.gameService.resetVotes();
  }

  /**
   * Save the confirmed estimate for the current story and automatically advance
   * to the next unestimated task in the list, or clear the story if none remain.
   * Uses the host's confirmedEstimate signal (pre-filled with Fibonacci coercion).
   */
  async saveAndContinue() {
    if (!this.roomId) return;

    const storyDesc = this.currentStory().trim();
    const finalEstimate = this.confirmedEstimate();

    await this.gameService.estimateNewTask(this.roomId, storyDesc, finalEstimate, this.currentTaskId());

    const next = this.nextTask();
    if (next) {
      await this.gameService.updateCurrentStory(this.roomId, next.description, next.id);
    }
  }

  async skipTask() {
    if (!this.roomId) return;
    await this.gameService.resetVotes();
    const next = this.nextTask();
    if (next) {
      await this.gameService.updateCurrentStory(this.roomId, next.description, next.id);
    } else {
      await this.gameService.updateCurrentStory(this.roomId, '', null);
    }
  }

  async selectTaskForEstimation(task: any) {
    if (!this.roomId) return;
    if (task) {
      await this.gameService.updateCurrentStory(this.roomId, task.description, task.id);
    } else {
      await this.gameService.updateCurrentStory(this.roomId, '', null);
    }
    this.gameService.resetVotes();
  }

  // --- Header & Story Editing Methods ---

  async onPersistentChange(isPersistent: boolean) {
    if (!this.roomId || !this.isHost()) return;
    try {
      await this.gameService.updateRoomPersistence(this.roomId, isPersistent);
      this.toastService.success(isPersistent ? 'Room set to persistent (will not expire)' : 'Room set to standard longevity');
    } catch (e) {
      console.error('Failed to update room persistence', e);
      this.toastService.error('Failed to update room persistence.');
    }
  }

  async onJiraDomainChange(domain: string) {
    if (!this.roomId || !this.isHost()) return;
    try {
      if (domain) {
        localStorage.setItem('POKER_JIRA_CUSTOM_DOMAIN', domain);
      } else {
        localStorage.removeItem('POKER_JIRA_CUSTOM_DOMAIN');
      }
      await this.gameService.updateRoomJiraCustomDomain(this.roomId, domain);
      this.toastService.success('Jira custom domain updated!');
    } catch (e) {
      console.error('Failed to update Jira custom domain', e);
      this.toastService.error('Failed to update Jira custom domain.');
    }
  }

  onRoomNameChange(newName: string) {
    this.currentRoomName.set(newName);
  }

  async saveRoomName() {
    if (!this.roomId || !this.isHost()) return;
    const name = this.currentRoomName().trim();
    if (name) {
      await this.gameService.updateRoomName(this.roomId, name);
    }
  }

  onStoryChange(newStory: string) {
    this.currentStory.set(newStory);
  }

  async saveCurrentStory() {
    if (!this.roomId || !this.isHost()) return;
    const story = this.currentStory();
    // Allow empty story to clear it
    await this.gameService.updateCurrentStory(this.roomId, story);
  }


  @HostListener('window:beforeunload')
  async onBeforeUnload() {
    if (!this.isLeaving && this.roomId && this.currentUser()) {
      await this.gameService.setPlayerStatus(this.roomId, this.currentUser()!.uid, 'Disconnected');
    }
  }

  ngOnDestroy() {
    // Check isLeaving to avoid overwriting clean exit with "Disconnected"
    if (!this.isLeaving && this.roomId && this.currentUser()) {
      this.gameService.setPlayerStatus(this.roomId, this.currentUser()!.uid, 'Disconnected');
    }
    // Always clear local subscription/ID when component is destroyed so we re-init correctly on return
    this.gameService.cleanupLocalGameState();
  }

  copyInviteLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      this.toastService.success('Invite link copied to clipboard!');
    });
  }
}
