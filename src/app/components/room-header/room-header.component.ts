import { Component, input, output, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TimerComponent } from '../timer/timer.component';

@Component({
    selector: 'neo-room-header',
    imports: [FormsModule, TimerComponent],
    template: `
    <header class="content-header">
      <div class="title-section">
        @if (isHost() && !title()) {
          <div class="editable-title-wrapper">
             <input class="editable-title" 
                   [ngModel]="roomName()" 
                   (ngModelChange)="onNameChange($event)"
                   (blur)="onNameBlur()"
                   (keyup.enter)="onNameBlur()"
                   placeholder="Enter Room Name">
              <span class="edit-icon">✎</span>
          </div>
        } @else {
          <h1>{{ title() || roomName() || 'Planning Session' }}</h1>
        }
        <div class="room-info">
          <span class="room-code">Room Code: <strong class="selectable-text">{{ roomId() }}</strong></span>
          <a href="javascript:void(0)" (click)="onCopyLink()" class="invite-link">
            <span class="link-icon">🔗</span>
            <span class="link-text">Copy Invite Link</span>
          </a>
          <neo-timer></neo-timer>
        </div>
      </div>
      <div class="header-actions">
        @if (isHost()) {
          <div class="settings-wrapper">
            <button class="btn-settings" (click)="toggleSettings()" [class.active]="showSettings()" title="Room Settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="settings-icon">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              <span>Settings</span>
            </button>

            @if (showSettings()) {
              <div class="settings-popover glass-panel">
                <div class="popover-header">
                  <h4>Room Settings</h4>
                  <button class="btn-close-popover" (click)="showSettings.set(false)">✕</button>
                </div>

                <div class="setting-item">
                  <label class="setting-checkbox-label">
                    <input type="checkbox" 
                           [ngModel]="isPersistent()" 
                           (ngModelChange)="onPersistentToggle($event)">
                    <span class="checkbox-title">Keep Room Active</span>
                  </label>
                  <p class="setting-desc">Preserves this room URL so it never expires when empty.</p>
                </div>

                <div class="setting-divider"></div>

                <div class="setting-item">
                  <label class="setting-label">Jira Custom Domain</label>
                  <input type="text" 
                         [ngModel]="localJiraDomain()" 
                         (ngModelChange)="localJiraDomain.set($event)"
                         (blur)="onJiraDomainBlur()"
                         (keyup.enter)="onJiraDomainBlur()"
                         placeholder="e.g. company.atlassian.net"
                         class="setting-input">
                  <p class="setting-desc">Task keys like <code>PROJ-123</code> will link to this domain.</p>
                </div>
              </div>
            }
          </div>
          <button class="btn-end-session" (click)="onEndSession()">End Session</button>
        } @else {
          <button class="btn-end-session" (click)="onEndSession()">Leave Room</button>
        }
      </div>
    </header>
  `,
    styleUrl: './room-header.component.css'
})
export class RoomHeaderComponent {
  roomId = input.required<string>();
  isHost = input<boolean>(false);
  roomName = input<string>(''); // Received from parent
  title = input<string>(''); // Override title
  isPersistent = input<boolean>(false);
  jiraCustomDomain = input<string>('');

  roomNameChange = output<string>(); // Emit changes to parent
  endSession = output<void>();
  copyLink = output<void>();
  nameBlur = output<void>();
  persistentChange = output<boolean>();
  jiraDomainChange = output<string>();

  showSettings = signal<boolean>(false);
  localJiraDomain = signal<string>('');

  constructor() {
    effect(() => {
      this.localJiraDomain.set(this.jiraCustomDomain());
    });
  }

  toggleSettings() {
    this.showSettings.set(!this.showSettings());
  }

  onPersistentToggle(newValue: boolean) {
    this.persistentChange.emit(newValue);
  }

  onJiraDomainBlur() {
    this.jiraDomainChange.emit(this.localJiraDomain().trim());
  }

  onEndSession() {
    this.endSession.emit();
  }

  onCopyLink() {
    this.copyLink.emit();
  }

  onNameChange(newName: string) {
    this.roomNameChange.emit(newName);
  }

  onNameBlur() {
    this.nameBlur.emit();
  }
}
