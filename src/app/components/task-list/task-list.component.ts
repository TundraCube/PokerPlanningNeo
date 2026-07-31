import { Component, input, output, signal, inject, computed, OnInit, effect } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { CdkDropList, CdkDrag, CdkDragHandle, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { JiraAuthService } from '../../services/jira-auth.service';
import { JiraApiService } from '../../services/jira-api.service';
import { firstValueFrom } from 'rxjs';
import { Task, GameService } from '../../game.service';
import { ModalService } from '../../services/modal.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'neo-task-list',
  imports: [FormsModule, CdkDropList, CdkDrag, CdkDragHandle],
  template: `
    <div class="task-list-container glass-panel">
      <div class="list-header-row">
        <div class="list-title-area">
          <h3>Task List</h3>
          @if (isHost()) {
            <div class="jira-auth-wrapper">
               @if (jiraAuth.accessToken()) {
                   <div class="jira-connected-badge" (click)="showJiraSettings.set(!showJiraSettings())">
                      <span class="dot-green"></span> Jira Connected ▾
                   </div>
                   @if (showJiraSettings()) {
                       <div class="jira-settings-popover glass-panel">
                           <h4>Jira Settings</h4>
                           <label>Target Site</label>
                           <select [ngModel]="selectedJiraSite()" (ngModelChange)="updateJiraSite($event)">
                               @for (site of jiraSites(); track site.id) {
                                   <option [value]="site.id">{{ site.name }}</option>
                               }
                           </select>
                           <label>Story Points Field ID</label>
                           <input type="text" [ngModel]="jiraSpField()" (ngModelChange)="updateJiraSpField($event)">
                           <button class="btn-danger-sm" (click)="disconnectJira()">Disconnect</button>
                       </div>
                   }
               } @else {
                   <button class="btn-jira-connect" (click)="jiraAuth.login()">
                      🔗 Connect Jira
                   </button>
               }
            </div>
          }
        </div>
        @if (isHost()) {
          <div class="add-task-form">
            <input 
              type="text" 
              [(ngModel)]="newTaskDescription" 
              (keyup.enter)="addTask()"
              placeholder="Jira URL or Task description..." 
              class="add-task-input"
            />
            <button (click)="addTask()" class="btn-add" [disabled]="!newTaskDescription().trim()">
              Add Task
            </button>
          </div>
        }
      </div>

      <div class="table-wrapper">
        @if (tasks().length === 0 && loadingTasks().length === 0) {
          <div class="empty-state">
            <p>No tasks in the list yet.</p>
          </div>
        } @else {
          <table class="tasks-table">
            <thead>
              <tr>
                @if (isHost()) {
                  <th class="col-drag"></th>
                }
                <th class="col-desc">TASK ID / NAME</th>
                <th class="col-estimate text-right">ESTIMATE</th>
                @if (isHost()) {
                  <th class="col-actions">Actions</th>
                }
              </tr>
            </thead>
            <tbody cdkDropList (cdkDropListDropped)="drop($event)">
              @for (lTask of loadingTasks(); track lTask.id) {
                <tr class="loading-row">
                  @if (isHost()) {
                    <td class="col-drag"></td>
                  }
                  <td class="task-desc">
                    <div class="jira-task-badge-wrapper">
                         <a [href]="getJiraLink(lTask)" target="_blank" class="jira-key-badge" (click)="$event.stopPropagation()">
                             {{ lTask.jiraKey }}
                         </a>
                         <span class="jira-summary skeleton-text"></span>
                    </div>
                  </td>
                  <td class="col-estimate text-right">
                    <span class="estimate-value-neo estimate-none">-</span>
                  </td>
                  @if (isHost()) {
                    <td class="col-actions">
                    </td>
                  }
                </tr>
              }
              @for (task of tasks(); track task.id) {
                <tr [class.active]="isActive(task)" 
                    (click)="isHost() ? (isActive(task) ? selectForEstimation(null) : selectForEstimation(task)) : null" 
                    [class.clickable]="isHost()"
                    cdkDrag
                    [cdkDragDisabled]="!isHost()">
                  @if (isHost()) {
                    <td class="col-drag" (click)="$event.stopPropagation()">
                      <div class="drag-handle" cdkDragHandle title="Drag to reorder">
                        <svg width="12" height="18" viewBox="0 0 12 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="3" cy="3" r="1.5" fill="currentColor"/>
                          <circle cx="3" cy="9" r="1.5" fill="currentColor"/>
                          <circle cx="3" cy="15" r="1.5" fill="currentColor"/>
                          <circle cx="9" cy="3" r="1.5" fill="currentColor"/>
                          <circle cx="9" cy="9" r="1.5" fill="currentColor"/>
                          <circle cx="9" cy="15" r="1.5" fill="currentColor"/>
                        </svg>
                      </div>
                    </td>
                  }
                  <td class="task-desc">
                    @if (task.jiraKey) {
                        <div class="jira-task-badge-wrapper">
                            <a [href]="getJiraLink(task)" target="_blank" class="jira-key-badge" (click)="$event.stopPropagation()">
                                {{ task.jiraKey }}
                            </a>
                            <span class="jira-summary" [class.skeleton-text]="refreshingTasks().has(task.id)" [title]="task.jiraSummary">
                                {{ refreshingTasks().has(task.id) ? '' : task.jiraSummary }}
                            </span>
                        </div>
                    } @else {
                        <span [innerHTML]="getParsedDescription(task.description)"></span>
                    }
                  </td>

                  <td class="col-estimate text-right">
                    @if (isHost()) {
                      <input 
                        type="text"
                        [ngModel]="task.finalEstimate || ''" 
                        (ngModelChange)="updateEstimate(task.id, $event)"
                        (click)="$event.stopPropagation()"
                        class="estimate-input"
                        [class]="getEstimateColorClass(task.finalEstimate || '')"
                        placeholder="-"
                        maxlength="5"
                      />
                    } @else {
                      <span class="estimate-value-neo" [class]="getEstimateColorClass(task.finalEstimate || '')">
                        {{ task.finalEstimate || '-' }}
                      </span>
                    }
                  </td>
                  @if (isHost()) {
                    <td class="col-actions">
                      <div class="actions-group">
                        @if (task.jiraKey && jiraAuth.accessToken()) {
                          <button 
                            class="btn-action btn-refresh" 
                            title="Refresh from Jira" 
                            (click)="refreshJiraSummary(task); $event.stopPropagation()"
                          >
                            ↻
                          </button>
                        }
                        <button 
                          (click)="deleteTask(task.id); $event.stopPropagation()" 
                          class="btn-action btn-delete"
                          title="Remove Task"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        }
        
        @if (isHost() && hasSyncableJiraTasks()) {
            <div class="bulk-sync-wrapper">
                <button class="btn-neo-primary btn-sync-all" (click)="syncAllJiraTasks()" [disabled]="isSyncingAll()">
                    {{ isSyncingAll() ? 'Syncing...' : 'Sync All Estimates to Jira' }}
                </button>
            </div>
        }
      </div>
    </div>
  `,
  styleUrl: './task-list.component.css'
})
export class TaskListComponent implements OnInit {
  roomId = input.required<string>();
  isHost = input<boolean>(false);
  tasks = input<Task[]>([]);
  currentStory = input<string>('');
  /** ID of the task currently being estimated — preferred over description matching */
  currentTaskId = input<string | null>(null);
  jiraCustomDomain = input<string>('');

  selectTask = output<Task | null>();

  newTaskDescription = signal('');
  loadingTasks = signal<{ id: string, jiraKey: string, jiraUrl: string }[]>([]);
  refreshingTasks = signal<Set<string>>(new Set());
  estimateOptions = ['0', '1', '2', '3', '5', '8', '13', '21', '?', '☕'];

  jiraAuth = inject(JiraAuthService);
  jiraApi = inject(JiraApiService);
  private gameService = inject(GameService);
  private sanitizer = inject(DomSanitizer);
  private modalService = inject(ModalService);
  private toastService = inject(ToastService);

  jiraSites = signal<any[]>([]);
  selectedJiraSite = signal<string>(localStorage.getItem('JIRA_SELECTED_SITE') || '');
  jiraSpField = signal<string>(localStorage.getItem('JIRA_SP_FIELD') || 'customfield_10016');
  showJiraSettings = signal(false);
  isSyncingAll = signal(false);

  constructor() {
    effect(() => {
      const sites = this.jiraSites();
      const current = this.selectedJiraSite();
      if (sites.length > 0 && !current) {
        this.updateJiraSite(sites[0].id);
      }
    });
  }

  ngOnInit() {
    if (this.isHost() && this.jiraAuth.accessToken()) {
      this.loadJiraSites();
    }
  }

  loadJiraSites() {
    this.jiraApi.getAccessibleResources().subscribe({
      next: (data) => {
        this.jiraSites.set(data);
      },
      error: (err) => {
        console.error('Failed to load Jira sites', err);
        if (err?.status === 401) {
          this.toastService.warning('Jira session expired. Please reconnect.');
        } else {
          this.toastService.error('Could not load Jira sites. Check your connection.');
        }
      }
    });
  }

  updateJiraSite(siteId: string) {
    this.selectedJiraSite.set(siteId);
    localStorage.setItem('JIRA_SELECTED_SITE', siteId);
  }

  updateJiraSpField(field: string) {
    this.jiraSpField.set(field);
    localStorage.setItem('JIRA_SP_FIELD', field);
  }

  disconnectJira() {
    this.jiraAuth.logout();
    this.showJiraSettings.set(false);
  }

  getEstimateColorClass(value: string): string {
    if (!value) return 'estimate-none';
    const n = Number(value);
    if (isNaN(n)) return 'estimate-special';
    if (n <= 1) return 'estimate-small';
    if (n <= 3) return 'estimate-medium';
    if (n <= 8) return 'estimate-large';
    return 'estimate-xlarge';
  }



  isActive(task: Task): boolean {
    const id = this.currentTaskId();
    return !!id && task.id === id;
  }

  getJiraLink(task: { jiraUrl?: string }): string {
    if (!task || !task.jiraUrl) return '';
    const customDomain = this.jiraCustomDomain() ? this.jiraCustomDomain().trim() : '';
    if (customDomain && task.jiraUrl.includes('domain.atlassian.net')) {
      return task.jiraUrl.replace('domain.atlassian.net', customDomain);
    }
    return task.jiraUrl;
  }

  getParsedDescription(text: string): SafeHtml {
    if (!text) return '';
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parsed = escaped.replace(urlRegex, (url) => {
      let targetUrl = url;
      const customDomain = this.jiraCustomDomain() ? this.jiraCustomDomain().trim() : '';
      if (customDomain && url.includes('domain.atlassian.net')) {
        targetUrl = url.replace('domain.atlassian.net', customDomain);
      }
      return `<a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="jira-link">${targetUrl}</a>`;
    });
    return this.sanitizer.bypassSecurityTrustHtml(parsed);
  }

  getParsedIssueKey(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';
    const browseMatch = trimmed.match(/\/browse\/([A-Za-z0-9]+-[0-9]+)/);
    if (browseMatch && browseMatch[1]) return browseMatch[1].toUpperCase();
    const keyMatch = trimmed.match(/^([A-Za-z0-9]+-[0-9]+)$/);
    if (keyMatch && keyMatch[1]) return keyMatch[1].toUpperCase();
    return '';
  }

  normalizeJiraUrl(url: string): string {
    if (!url) return '';
    const protocolMatch = url.match(/^(?:https?:?\/*)+/i);
    if (protocolMatch) {
      const cleanPath = url.substring(protocolMatch[0].length);
      return `https://${cleanPath}`;
    }
    return `https://${url}`;
  }

  async addTask() {
    const desc = this.newTaskDescription().trim();
    if (!desc) return;

    let jiraMeta: any = undefined;
    const jiraKey = this.getParsedIssueKey(desc);

    // Check for duplicates
    if (jiraKey) {
      if (this.tasks().some(t => t.jiraKey === jiraKey)) {
        this.toastService.warning('This story is already in the list!');
        this.newTaskDescription.set('');
        return;
      }
    } else {
      if (this.tasks().some(t => t.description.toLowerCase() === desc.toLowerCase())) {
        this.toastService.warning('This task is already in the list!');
        this.newTaskDescription.set('');
        return;
      }
    }

    if (jiraKey) {
      const loadingId = Math.random().toString(36).substring(7);
      let cloudId = this.selectedJiraSite();
      if (desc.includes('.atlassian.net')) {
        const match = desc.match(/https?:\/\/([^/]+)/);
        if (match && match[1]) {
          const domain = match[1].toLowerCase();
          const matchingSite = this.jiraSites().find(s => s.url.toLowerCase().includes(domain));
          if (matchingSite) cloudId = matchingSite.id;
        }
      }

      const customDomain = this.jiraCustomDomain() ? this.jiraCustomDomain().trim() : '';
      const fallbackDomain = customDomain || 'domain.atlassian.net';
      const defaultDomain = desc.includes('.atlassian.net') ? desc.match(/https?:\/\/([^/]+)/)?.[1] || fallbackDomain : fallbackDomain;
      const jiraUrl = this.normalizeJiraUrl(desc.startsWith('http') ? desc : `https://${this.jiraSites().find(s => s.id === cloudId)?.url || defaultDomain}/browse/${jiraKey}`);

      jiraMeta = {
        jiraKey,
        jiraSummary: this.jiraAuth.accessToken() ? 'Failed to fetch summary' : 'Log in to fetch summary',
        jiraUrl
      };

      if (this.jiraAuth.accessToken()) {
        this.loadingTasks.update(lt => [...lt, { id: loadingId, jiraKey, jiraUrl }]);
        this.newTaskDescription.set('');

        try {
          if (cloudId) {
            const issue: any = await firstValueFrom(this.jiraApi.getIssue(cloudId, jiraKey));
            jiraMeta.jiraSummary = issue.fields?.summary || 'No summary';
          }
        } catch (e: any) {
          console.error('Failed to auto-fetch Jira details', e);
          if (e?.status === 401) {
            this.toastService.error('Your Jira token might be expired. Please click Jira Connected -> Disconnect, and connect again.');
          }
        } finally {
          this.loadingTasks.update(lt => lt.filter(t => t.id !== loadingId));
        }
      } else {
        this.newTaskDescription.set('');
      }
    } else {
      this.newTaskDescription.set('');
    }

    try {
      const finalDesc = jiraMeta ? `${jiraMeta.jiraKey}: ${jiraMeta.jiraSummary}` : desc;
      await this.gameService.addTask(this.roomId(), finalDesc, jiraMeta);
    } catch (e) {
      console.error('Failed to add task', e);
    }
  }

  async deleteTask(taskId: string) {
    const confirmed = await this.modalService.confirm(
      'Remove Task',
      'Are you sure you want to remove this task?',
      'Remove',
      'Cancel'
    );
    if (confirmed) {
      try {
        await this.gameService.deleteTask(this.roomId(), taskId);
      } catch (e) {
        console.error('Failed to delete task', e);
      }
    }
  }

  async updateEstimate(taskId: string, estimate: string) {
    try {
      await this.gameService.updateTaskEstimate(this.roomId(), taskId, estimate);
    } catch (e) {
      console.error('Failed to update task estimate', e);
    }
  }

  selectForEstimation(task: Task | null) {
    this.selectTask.emit(task);
  }

  async refreshJiraSummary(task: Task) {
    if (!this.selectedJiraSite() || !task.jiraKey) return;
    this.refreshingTasks.update(s => new Set(s).add(task.id));
    try {
      const issue: any = await firstValueFrom(this.jiraApi.getIssue(this.selectedJiraSite(), task.jiraKey));
      const newSummary = issue.fields?.summary;
      if (newSummary && newSummary !== task.jiraSummary) {
        await this.gameService.updateTaskSummary(this.roomId(), task.id, newSummary);
      }
    } catch (e) {
      console.error('Failed to refresh summary', e);
    } finally {
      this.refreshingTasks.update(s => {
        const next = new Set(s);
        next.delete(task.id);
        return next;
      });
    }
  }

  isInvalidSyncEstimate(est?: string): boolean {
    if (!est) return true;
    const n = Number(est);
    return isNaN(n);
  }

  async syncIndividualTask(task: Task) {
    if (this.isInvalidSyncEstimate(task.finalEstimate) || !task.jiraKey || !this.selectedJiraSite()) return;
    try {
      await this.gameService.updateTaskJiraSyncStatus(this.roomId(), task.id, 'pending');
      await firstValueFrom(this.jiraApi.updateIssueStoryPoints(this.selectedJiraSite(), task.jiraKey, this.jiraSpField(), Number(task.finalEstimate)) as any);
      await this.gameService.updateTaskJiraSyncStatus(this.roomId(), task.id, 'synced');
    } catch (e: any) {
      console.error('Failed to sync to Jira', e);
      const errorBody = e?.error;
      const msg = errorBody?.errorMessages?.join(', ') || JSON.stringify(errorBody?.errors) || e.message || 'Unknown error';
      this.toastService.error(`Jira Sync Failed for ${task.jiraKey}: ${msg}`);
      await this.gameService.updateTaskJiraSyncStatus(this.roomId(), task.id, 'failed');
    }
  }

  hasSyncableJiraTasks(): boolean {
    return this.tasks().some(t => t.jiraKey && !this.isInvalidSyncEstimate(t.finalEstimate) && t.jiraSyncStatus !== 'synced');
  }

  async syncAllJiraTasks() {
    this.isSyncingAll.set(true);
    const syncableTasks = this.tasks().filter(t => t.jiraKey && !this.isInvalidSyncEstimate(t.finalEstimate) && t.jiraSyncStatus !== 'synced');
    for (const task of syncableTasks) {
      await this.syncIndividualTask(task);
    }
    this.isSyncingAll.set(false);
  }

  async drop(event: CdkDragDrop<Task[]>) {
    if (!this.isHost()) return;
    if (event.previousIndex === event.currentIndex) return;

    const reordered = [...this.tasks()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);

    try {
      await this.gameService.reorderTasks(this.roomId(), reordered);
    } catch (e) {
      console.error('Failed to reorder tasks', e);
      this.toastService.error('Failed to reorder tasks. Please try again.');
    }
  }
}

