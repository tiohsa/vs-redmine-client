export const settingsScript = String.raw`// ── Settings ──────────────────────────────────────────────────────────────
const sortFields=function(){ return [['',STRINGS.sortDefaultOption],['priority',STRINGS.sortPriority],['status',STRINGS.sortStatus],['tracker',STRINGS.sortTracker],['assignee',STRINGS.sortAssignee],['dueDate',STRINGS.dueDateLabel],['startDate',STRINGS.startDate]]; };
function selectOptions(options,current){ return options.map(function(option){ return '<option value="'+esc(option[0])+'"'+(option[0] === current ? ' selected' : '')+'>'+esc(option[1])+'</option>'; }).join(''); }
function dueToggles(rule){ return [['set-dd-overdue','showOverdue',STRINGS.dueOverdue],['set-dd-1d','showWithin1Day',STRINGS.due1Day],['set-dd-3d','showWithin3Days',STRINGS.due3Days],['set-dd-7d','showWithin7Days',STRINGS.due7Days]].map(function(item){ return '<label class="setting-row"><span class="setting-label">'+esc(item[2])+'</span><input class="setting-check" type="checkbox" id="'+item[0]+'"'+(rule[item[1]]?' checked':'')+'></label>'; }).join(''); }

function renderSettingsBase(){
  if(!state) return;
  const settings=state.settings;
  const settingsBaseUrl=settings.baseUrl;
  const generation=++settingsRenderGeneration;
  const requestForRenderedSettings=function(type,payload){
    if(generation !== settingsRenderGeneration || settingsBaseUrl !== state?.settings?.baseUrl) return;
    return req(type,payload);
  };
  const defaults=settings.editorDefaults || {};
  const element=document.getElementById('settings-content');
  const hadCategories=!!element.querySelector('.settings-category');
  const openCategories=new Set(Array.from(element.querySelectorAll('.settings-category[open]')).map(function(category){ return category.dataset.category; }));
  const active=document.activeElement;
  const focused=renderedSettingsBaseUrl === settings.baseUrl && active && element.contains(active) && active.id && typeof active.defaultValue === 'string' && active.value !== active.defaultValue ? {id:active.id,value:active.value} : null;
  element.innerHTML='<section class="settings-section" data-section="connection"><h3>'+STRINGS.sectionConnection+'</h3>'+
    '<label class="setting-row" for="set-base-url"><span class="setting-label">'+STRINGS.redmineUrlLabel+'</span><input class="setting-input" id="set-base-url" type="url" value="'+esc(settings.baseUrl)+'" autocomplete="url"></label>'+
    '<label class="setting-row" for="set-default-project"><span class="setting-label">'+STRINGS.defaultProjectLabel+'</span><input class="setting-input" id="set-default-project" type="text" value="'+esc(settings.defaultProjectId)+'"></label>'+
    '<label class="setting-row" for="set-request-timeout"><span class="setting-label">'+STRINGS.requestTimeoutLabel+'</span><input class="setting-input setting-input-num" id="set-request-timeout" type="number" min="1" step="1" value="'+esc(settings.requestTimeoutMs)+'"></label>'+
    '<label class="setting-row" for="set-ignore-ssl"><span class="setting-label">'+STRINGS.ignoreSSLErrorsLabel+'</span><input class="setting-check" id="set-ignore-ssl" type="checkbox"'+(settings.ignoreSSLErrors?' checked':'')+'></label><p class="setting-warning" role="note">'+esc(STRINGS.ignoreSSLErrorsWarning)+'</p>'+
    '<div class="setting-row"><span class="setting-label">'+STRINGS.sectionApiKey+'</span><span class="setting-value apikey-status apikey-status-'+(settings.apiKeyStatus === 'set'?'set':'notset')+'">'+(settings.apiKeyStatus === 'set'?STRINGS.apiKeyStatusSet:STRINGS.apiKeyStatusNotSet)+'</span></div><div class="apikey-actions"><button class="btn btn-secondary" id="set-apikey-btn" type="button">'+(settings.apiKeyStatus === 'set'?STRINGS.changeApiKeyBtn:STRINGS.setApiKeyBtn)+'</button>'+(settings.apiKeyStatus === 'set'?'<button class="btn btn-secondary" id="clear-api-key-btn" type="button">'+STRINGS.clearApiKeyBtn+'</button>':'')+'</div></section>'+
    '<section class="settings-section" data-section="tickets"><h3>'+STRINGS.sectionTickets+'</h3>'+
    '<label class="setting-row" for="set-ticket-limit"><span class="setting-label">'+STRINGS.ticketLimitLabel+'</span><input class="setting-input setting-input-num" id="set-ticket-limit" type="number" min="1" max="500" value="'+esc(settings.ticketListLimit)+'"></label>'+
    '<label class="setting-row" for="set-include-children"><span class="setting-label">'+STRINGS.includeChildProjectsLabel+'</span><input class="setting-check" id="set-include-children" type="checkbox"'+(settings.includeChildProjects?' checked':'')+'></label>'+
    '<label class="setting-row" for="set-show-status"><span class="setting-label">'+STRINGS.showStatusLabel+'</span><input class="setting-check" id="set-show-status" type="checkbox"'+(settings.showStatus?' checked':'')+'></label>'+
    '<label class="setting-row" for="set-follow-active-editor"><span class="setting-label">'+STRINGS.followActiveEditorLabel+'</span><input class="setting-check" id="set-follow-active-editor" type="checkbox"'+(settings.followActiveEditor?' checked':'')+'></label></section>'+
    '<section class="settings-section" data-section="editor"><h3>'+STRINGS.sectionEditor+'</h3>'+
    '<label class="setting-row" for="set-editor-storage"><span class="setting-label">'+STRINGS.editorStorageDirectoryLabel+'</span><input class="setting-input" id="set-editor-storage" type="text" value="'+esc(settings.editorStorageDirectory)+'"></label>'+
    '<label class="setting-row" for="set-editor-subject"><span class="setting-label">'+STRINGS.defaultSubjectLabel+'</span><input class="setting-input" id="set-editor-subject" type="text" data-editor-default="subject" value="'+esc(defaults.subject)+'"></label>'+
    '<label class="setting-row setting-row-stacked" for="set-editor-description"><span class="setting-label">'+STRINGS.defaultDescriptionLabel+'</span><textarea class="setting-input" id="set-editor-description" data-editor-default="description" rows="3">'+esc(defaults.description)+'</textarea></label>'+
    '<label class="setting-row" for="set-editor-tracker"><span class="setting-label">'+STRINGS.defaultTrackerLabel+'</span><input class="setting-input" id="set-editor-tracker" type="text" data-editor-default="tracker" value="'+esc(defaults.tracker)+'"></label>'+
    '<label class="setting-row" for="set-editor-priority"><span class="setting-label">'+STRINGS.defaultPriorityLabel+'</span><input class="setting-input" id="set-editor-priority" type="text" data-editor-default="priority" value="'+esc(defaults.priority)+'"></label>'+
    '<label class="setting-row" for="set-editor-status"><span class="setting-label">'+STRINGS.defaultStatusLabel+'</span><input class="setting-input" id="set-editor-status" type="text" data-editor-default="status" value="'+esc(defaults.status)+'"></label>'+
    '<label class="setting-row" for="set-editor-due-date"><span class="setting-label">'+STRINGS.defaultDueDateLabel+'</span><input class="setting-input" id="set-editor-due-date" type="date" data-editor-default="due_date" value="'+esc(defaults.due_date)+'"></label>'+
    '<button class="btn btn-secondary" id="reset-editor-defaults-btn" type="button">'+STRINGS.resetEditorDefaults+'</button></section>'+
    '<section class="settings-section" data-section="ticket-filter"><h3>'+STRINGS.sectionTicketFilter+'</h3><div id="quick-filter-row"><label class="quick-filter-label" for="assignee-filter-select">'+STRINGS.filterAssigneeLabel+'</label><select id="assignee-filter-select" class="quick-filter-select" multiple size="4" aria-label="'+esc(STRINGS.filterAssigneeAria)+'"></select><label class="quick-filter-check"><input type="checkbox" id="assignee-unassigned-toggle"> '+STRINGS.filterIncludeUnassignedLabel+'</label><label class="quick-filter-label" for="status-filter-select">'+STRINGS.filterStatusLabel+'</label><select id="status-filter-select" class="quick-filter-select" multiple size="4" aria-label="'+esc(STRINGS.filterStatusAria)+'"></select></div></section>'+
    '<section class="settings-section" data-section="sort"><h3>'+STRINGS.sectionSort+'</h3><label class="setting-row"><span class="setting-label">'+STRINGS.sortFieldLabel+'</span><select class="setting-select" id="set-sort-field">'+selectOptions(sortFields(),settings.sort.field || '')+'</select></label><label class="setting-row"><span class="setting-label">'+STRINGS.sortDirectionLabel+'</span><select class="setting-select" id="set-sort-dir">'+selectOptions([['asc',STRINGS.sortAsc],['desc',STRINGS.sortDesc]],settings.sort.direction)+'</select></label></section>'+
    '<section class="settings-section" data-section="due-date"><h3>'+STRINGS.sectionDueDate+'</h3>'+dueToggles(settings.dueDate)+'</section>'+
    '<section class="settings-section" data-section="sync"><h3>'+STRINGS.sectionSync+'</h3><label class="setting-row"><span class="setting-label">'+STRINGS.offlineSyncModeLabel+'</span><select class="setting-select" id="set-sync-mode">'+selectOptions([['auto',STRINGS.offlineSyncAuto],['manual',STRINGS.offlineSyncManual]],settings.offlineSyncMode)+'</select></label></section>';
  element.insertAdjacentHTML('beforeend','<section class="settings-section" data-section="maintenance"><h3>'+esc(STRINGS.sectionMaintenance)+'</h3>'+
    '<h4 class="maintenance-heading">'+esc(STRINGS.dashboardCacheHeading)+'</h4><p class="maintenance-description">'+esc(STRINGS.dashboardCacheDescription)+'</p><button class="btn btn-secondary" id="dashboard-cache-reset-btn" type="button">'+esc(STRINGS.resetDashboardCache)+'</button>'+
    '<h4 class="maintenance-heading">'+esc(STRINGS.dashboardViewStateHeading)+'</h4><p class="maintenance-description">'+esc(STRINGS.dashboardViewStateDescription)+'</p><button class="btn btn-secondary" id="settings-reset-view-btn" type="button">'+esc(STRINGS.resetViewState)+'</button>'+
    '<p class="maintenance-safety-note" role="note">'+esc(STRINGS.maintenanceSafetyNote)+'</p></section>');
  const sections=new Map(Array.from(element.children).map(function(section){ return [section.dataset.section,section]; })); element.replaceChildren();
  [['tickets',STRINGS.sectionTickets,['tickets','ticket-filter','sort','due-date']],['sync',STRINGS.sectionSync,['sync']],['editor',STRINGS.sectionEditor,['editor']],['connection',STRINGS.sectionConnection,['connection']],['maintenance',STRINGS.sectionMaintenance,['maintenance']]].forEach(function(group){
    const category=document.createElement('details'); category.className='settings-category'; category.dataset.category=group[0]; category.id='settings-'+group[0]; category.open=hadCategories ? openCategories.has(group[0]) : group[0] === 'tickets';
    const heading=document.createElement('summary'); heading.id='settings-'+group[0]+'-summary'; heading.textContent=group[1]; category.appendChild(heading);
    group[2].forEach(function(id){ const section=sections.get(id); if(section) category.appendChild(section); }); element.appendChild(category);
  });
  if(focused){ const input=document.getElementById(focused.id); if(input && 'value' in input) input.value=focused.value; }
  renderedSettingsBaseUrl=settings.baseUrl;
  const assignees=state.ticketFilterOptions.assignees || []; const statuses=state.ticketFilterOptions.statuses || []; const assigneeSelect=document.getElementById('assignee-filter-select'); const statusSelect=document.getElementById('status-filter-select'); assigneeSelect.innerHTML=assignees.map(function(item){ return '<option value="'+item.id+'"'+((settings.filters.assigneeIds || []).indexOf(item.id)>=0?' selected':'')+'>'+esc(item.name)+'</option>'; }).join(''); statusSelect.innerHTML=statuses.map(function(item){ return '<option value="'+item.id+'"'+((settings.filters.statusIds || []).indexOf(item.id)>=0?' selected':'')+'>'+esc(item.name)+'</option>'; }).join(''); assigneeSelect.disabled=!assignees.length; statusSelect.disabled=!statuses.length; document.getElementById('assignee-unassigned-toggle').checked=!!settings.filters.includeUnassigned;
  const updateFilters=function(){ requestForRenderedSettings('settings.update',{patch:{filters:Object.assign({},settings.filters,{assigneeIds:Array.from(assigneeSelect.selectedOptions).map(function(option){ return Number(option.value); }),statusIds:Array.from(statusSelect.selectedOptions).map(function(option){ return Number(option.value); }),includeUnassigned:document.getElementById('assignee-unassigned-toggle').checked})}}); }; assigneeSelect.addEventListener('change',updateFilters); statusSelect.addEventListener('change',updateFilters); document.getElementById('assignee-unassigned-toggle').addEventListener('change',updateFilters);
  document.getElementById('set-sort-field').addEventListener('change',function(){ requestForRenderedSettings('settings.update',{patch:{sort:{field:this.value || undefined,direction:settings.sort.direction}}}); }); document.getElementById('set-sort-dir').addEventListener('change',function(){ requestForRenderedSettings('settings.update',{patch:{sort:{field:settings.sort.field,direction:this.value}}}); });
  [['set-dd-overdue','showOverdue'],['set-dd-1d','showWithin1Day'],['set-dd-3d','showWithin3Days'],['set-dd-7d','showWithin7Days']].forEach(function(item){ document.getElementById(item[0]).addEventListener('change',function(){ const due=Object.assign({},settings.dueDate); due[item[1]]=this.checked; requestForRenderedSettings('settings.update',{patch:{dueDate:due}}); }); });
  const bindSettingInput=function(input,type,buildPayload){
    const commit=function(){
      if(input.value === input.defaultValue) return;
      const payload=buildPayload(input.value);
      if(payload === undefined) return;
      if(requestForRenderedSettings(type,payload)) input.defaultValue=input.value;
    };
    input.addEventListener('change',commit);
    input.addEventListener('blur',commit);
  };
  const bindConnectionInput=function(id,field,parse){
    bindSettingInput(document.getElementById(id),'settings.updateConnection',function(value){
      const parsed=parse ? parse(value) : value;
      return parsed === undefined ? undefined : {patch:{[field]:parsed}};
    });
  };
  bindConnectionInput('set-base-url','baseUrl');
  bindConnectionInput('set-default-project','defaultProjectId');
  bindConnectionInput('set-request-timeout','requestTimeoutMs',function(value){ const number=Number(value); return Number.isFinite(number) && number > 0 ? number : undefined; });
  document.getElementById('set-ignore-ssl').addEventListener('change',function(){ requestForRenderedSettings('settings.updateConnection',{patch:{ignoreSSLErrors:this.checked}}); });
  bindSettingInput(document.getElementById('set-ticket-limit'),'settings.updateGeneral',function(value){ const number=Number(value); return number >= 1 && number <= 500 ? {patch:{ticketListLimit:number}} : undefined; });
  document.getElementById('set-include-children').addEventListener('change',function(){ requestForRenderedSettings('settings.updateGeneral',{patch:{includeChildProjects:this.checked}}); }); document.getElementById('set-show-status').addEventListener('change',function(){ requestForRenderedSettings('settings.updateGeneral',{patch:{showStatus:this.checked}}); }); document.getElementById('set-follow-active-editor').addEventListener('change',function(){ requestForRenderedSettings('settings.updateGeneral',{patch:{followActiveEditor:this.checked}}); }); document.getElementById('set-sync-mode').addEventListener('change',function(){ requestForRenderedSettings('settings.updateGeneral',{patch:{offlineSyncMode:this.value}}); });
  bindSettingInput(document.getElementById('set-editor-storage'),'settings.updateEditor',function(value){ return {patch:{editorStorageDirectory:value}}; });
  document.querySelectorAll('[data-editor-default]').forEach(function(input){ bindSettingInput(input,'settings.updateEditorDefault',function(value){ return {field:input.dataset.editorDefault,value:value}; }); });
  document.getElementById('reset-editor-defaults-btn').addEventListener('click',function(){ requestForRenderedSettings('settings.resetEditorDefaults',{fields:['subject','description','tracker','priority','status','due_date']}); });
  document.getElementById('set-apikey-btn').addEventListener('click',function(){ requestForRenderedSettings('apiKey.set'); }); document.getElementById('clear-api-key-btn')?.addEventListener('click',function(){ requestForRenderedSettings('apiKey.clear'); }); document.getElementById('settings-reset-btn').onclick=function(){ requestForRenderedSettings('settings.reset'); };
  const openSettingsJsonBtn = document.getElementById('open-settings-json-btn');
  if(openSettingsJsonBtn){ openSettingsJsonBtn.onclick=function(){ req('settings.openJson'); }; }
  document.getElementById('dashboard-cache-reset-btn').addEventListener('click',function(){ req('dashboard.resetCache'); }); document.getElementById('settings-reset-view-btn').addEventListener('click',resetViewState);
}

function resetViewState(){
  ticketLayoutMode='auto'; detailFocus=false; compactMode=false; quickFilters.clear(); quickFilters.add('open');
  expandedTicketIds.clear(); collapsedTicketIds.clear(); expandedComments.clear();
  activeTicketActionMenuId=null; activeTicketActionAnchorTop=null; searchQuery=''; closeProjectPicker(false);
  if(searchTimer){ window.clearTimeout(searchTimer); searchTimer=null; }
  searchInput.value=''; updateSearchClearButton(); filterDialog.classList.add('hidden'); closeLayoutPopover();
  document.querySelectorAll('.settings-category').forEach(function(category){ category.open=category.dataset.category === 'tickets'; });
  const nextState=Object.assign({},vscode.getState() || {},{ticketLayoutMode:ticketLayoutMode,detailFocus:detailFocus,compactMode:compactMode,quickFilters:['open']});
  delete nextState.detailTab;
  vscode.setState(nextState);
  submitSearch();
  render(); applyTicketLayoutMode(); if(typeof applyCompactMode === 'function') applyCompactMode(); showToast('success',STRINGS.viewStateReset);
}

function renderSettings(){
  renderSettingsBase();
}

`;
