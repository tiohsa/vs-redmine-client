import { dashboardActionPaths } from "../dashboardActionIcons";

export const displayHelpersScript = String.raw`// ── Display helpers ───────────────────────────────────────────────────────
const SYNC_META = {
  Dirty: {label:STRINGS.syncDirty, badge:'sync-dirty', icon:'•'},
  Queued: {label:STRINGS.syncQueued, badge:'sync-queued', icon:'→'},
  RecoveryPending: {label:STRINGS.syncRecoveryPending, badge:'sync-review', icon:'△'},
  CommitUnknown: {label:STRINGS.syncOutcomeUnknown, badge:'sync-review', icon:'△'},
  Abandoned: {label:STRINGS.syncAbandoned, badge:'sync-failed', icon:'×'},
  Conflict: {label:STRINGS.syncConflict, badge:'sync-conflict', icon:'△'},
  Failed: {label:STRINGS.syncFailed, badge:'sync-failed', icon:'×'},
  Syncing: {label:STRINGS.syncSyncing, badge:'sync-syncing', icon:'↻'},
};
function syncLabel(value){ return SYNC_META[value] ? SYNC_META[value].label : value === 'Synced' ? STRINGS.synced : value === 'Draft' ? STRINGS.draft : String(value || ''); }
function ticketSyncBadgeLabel(value){ return value === 'Dirty' ? STRINGS.syncEditing : value === 'Queued' ? STRINGS.syncQueued : syncLabel(value); }
function syncBadgeClass(value){ return SYNC_META[value] ? SYNC_META[value].badge : ''; }
function badge(label, className, icon){
  return '<span class="badge '+(className || '')+'"><span class="badge-icon" aria-hidden="true">'+esc(icon || '•')+'</span><span>'+esc(label)+'</span></span>';
}
function metadataBadge(label, className, category){
  return label ? '<span class="badge ticket-metadata '+className+'" title="'+esc(category+': '+label)+'" aria-label="'+esc(category+': '+label)+'">'+esc(label)+'</span>' : '';
}
function actionIcon(name){
  const paths=${JSON.stringify(dashboardActionPaths)};
  return '<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'+paths[name]+'"/></svg>';
}
function syncBadge(value){
  const meta = SYNC_META[value];
  return meta ? badge(meta.label, meta.badge, meta.icon) : '';
}
function initials(name){
  const value = String(name || '').trim();
  if(!value) return '?';
  const chars = Array.from(value.replace(/\s+/g,''));
  return chars.slice(0,2).join('').toUpperCase();
}
function hasAssignee(name){ return String(name || '').trim() !== ''; }
function avatar(name, className){
  const label = name || STRINGS.assigneeUnassigned;
  return '<span class="avatar '+(className || '')+'" role="img" aria-label="'+esc(label)+'">'+esc(initials(name))+'</span>';
}
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;
function daysUntilDateOnly(value, now){
  const match = DATE_ONLY_PATTERN.exec(String(value || ''));
  if(!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = Date.UTC(year,month - 1,day);
  const targetDate = new Date(target);
  if(targetDate.getUTCFullYear() !== year || targetDate.getUTCMonth() !== month - 1 || targetDate.getUTCDate() !== day) return undefined;
  const current = now || new Date();
  const today = Date.UTC(current.getFullYear(),current.getMonth(),current.getDate());
  return Math.round((target - today) / DAY_MS);
}
function resolveDueDateBadge(dueDate, rule, now){
  if(!dueDate || !rule) return null;
  const difference = daysUntilDateOnly(dueDate, now);
  if(difference === undefined) return null;
  if(difference < 0 && rule.showOverdue) return {label:STRINGS.dueOverdue,cls:'due-overdue',icon:'!'};
  if(difference >= 0 && difference <= 1 && rule.showWithin1Day) return {label:STRINGS.due1Day,cls:'due-1day',icon:'!'};
  if(difference >= 0 && difference <= 3 && rule.showWithin3Days) return {label:STRINGS.due3Days,cls:'due-3days',icon:'•'};
  if(difference >= 0 && difference <= 7 && rule.showWithin7Days) return {label:STRINGS.due7Days,cls:'due-7days',icon:'•'};
  return null;
}
function dueBadge(ticket){
  const showDueDate = state.settings && state.settings.showDueDate !== false;
  if(!showDueDate) return '';
  const data = resolveDueDateBadge(ticket.dueDate, state.settings.dueDate);
  return data ? badge(data.label,data.cls,data.icon) : '';
}
`;
