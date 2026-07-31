import '@angular/compiler';
import { describe, it, expect } from 'vitest';
import { TaskListComponent } from './task-list.component';

describe('TaskListComponent - getParsedIssueKey', () => {
  const getParsedIssueKey = TaskListComponent.prototype.getParsedIssueKey;

  it('should parse a pure Jira key correctly', () => {
    const key = getParsedIssueKey('JIRA-1234');
    expect(key).toBe('JIRA-1234');
  });

  it('should parse a Jira key from browse URL correctly', () => {
    const key = getParsedIssueKey('https://company.atlassian.net/browse/JIRA-1234');
    expect(key).toBe('JIRA-1234');
  });

  it('should return empty string for non-matching input', () => {
    const key = getParsedIssueKey('Some random description task');
    expect(key).toBe('');
  });
});

describe('TaskListComponent - normalizeJiraUrl', () => {
  const normalizeJiraUrl = TaskListComponent.prototype.normalizeJiraUrl;

  it('should pass through clean https URLs', () => {
    expect(normalizeJiraUrl('https://company.atlassian.net/browse/JIRA-1234'))
      .toBe('https://company.atlassian.net/browse/JIRA-1234');
  });

  it('should normalize double protocol prefix https://https://', () => {
    expect(normalizeJiraUrl('https://https://company.atlassian.net/browse/JIRA-1234'))
      .toBe('https://company.atlassian.net/browse/JIRA-1234');
  });

  it('should normalize malformed double protocol prefix https://https//', () => {
    expect(normalizeJiraUrl('https://https//company.atlassian.net/browse/JIRA-1234'))
      .toBe('https://company.atlassian.net/browse/JIRA-1234');
  });

  it('should handle prefixing a plain domain', () => {
    expect(normalizeJiraUrl('company.atlassian.net/browse/JIRA-1234'))
      .toBe('https://company.atlassian.net/browse/JIRA-1234');
  });

  it('should return empty string for empty input', () => {
    expect(normalizeJiraUrl('')).toBe('');
  });
});

describe('TaskListComponent - getJiraLink', () => {
  it('should replace domain.atlassian.net with custom domain', () => {
    const context = {
      jiraCustomDomain: () => 'my-company.atlassian.net'
    };
    const getJiraLink = TaskListComponent.prototype.getJiraLink.bind(context as any);
    const link = getJiraLink({ jiraUrl: 'https://domain.atlassian.net/browse/PROJ-123' });
    expect(link).toBe('https://my-company.atlassian.net/browse/PROJ-123');
  });

  it('should return original URL if no custom domain is set', () => {
    const context = {
      jiraCustomDomain: () => ''
    };
    const getJiraLink = TaskListComponent.prototype.getJiraLink.bind(context as any);
    const link = getJiraLink({ jiraUrl: 'https://domain.atlassian.net/browse/PROJ-123' });
    expect(link).toBe('https://domain.atlassian.net/browse/PROJ-123');
  });

  it('should return empty string if task has no jiraUrl', () => {
    const context = {
      jiraCustomDomain: () => 'my-company.atlassian.net'
    };
    const getJiraLink = TaskListComponent.prototype.getJiraLink.bind(context as any);
    const link = getJiraLink({});
    expect(link).toBe('');
  });
});
