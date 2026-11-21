export const projectPickerScript = {
  controls: String.raw`document.getElementById('include-children').addEventListener('click', function(){
  const next = this.getAttribute('aria-pressed') !== 'true';
  this.setAttribute('aria-pressed', String(next));
  this.title = next ? STRINGS.includeChildrenOn : STRINGS.includeChildrenOff;
  req('project.toggleChildren',{includeChildProjects:next});
});
const projectPicker = document.getElementById('project-picker');
const projectSelectTrigger = document.getElementById('project-select-trigger');
const projectSelectLabel = document.getElementById('project-select-label');
const projectPickerPopup = document.getElementById('project-picker-popup');
const projectListbox = document.getElementById('project-listbox');
const projectSearchInput = document.getElementById('project-search-input');
const projectSearchClearButton = document.getElementById('project-search-clear-btn');
let projectPickerOpen = false;
let activeProjectId = null;
let projectSearchComposing = false;
projectSelectTrigger.addEventListener('click',function(){ if(projectPickerOpen) closeProjectPicker(false); else openProjectPicker(); });
projectSelectTrigger.addEventListener('keydown',function(event){ if(event.key === 'ArrowDown' && !projectPickerOpen){ event.preventDefault(); openProjectPicker(); } });
projectSearchInput.addEventListener('input',function(){ if(!projectPickerOpen) return; projectSearchQuery=this.value; renderProjectSelect(true); });
projectSearchInput.addEventListener('compositionstart',function(){ projectSearchComposing=true; });
projectSearchInput.addEventListener('compositionend',function(){ projectSearchComposing=false; if(!projectPickerOpen){ this.value=''; return; } projectSearchQuery=this.value; renderProjectSelect(true); });
projectSearchInput.addEventListener('keydown',function(event){
  if(projectSearchComposing || event.isComposing || event.keyCode === 229) return;
  if(event.key === 'Escape'){ closeProjectPicker(true); event.preventDefault(); return; }
  if(event.key === 'ArrowDown' || event.key === 'ArrowUp'){
    const options=Array.from(projectListbox.querySelectorAll('[role="option"]'));
    if(options.length===0) return;
    const currentIndex=options.findIndex(function(option){ return Number(option.dataset.projectId)===activeProjectId; });
    const nextIndex=currentIndex < 0 ? (event.key === 'ArrowDown' ? 0 : options.length-1) : Math.max(0,Math.min(options.length-1,currentIndex+(event.key === 'ArrowDown' ? 1 : -1)));
    setActiveProject(Number(options[nextIndex].dataset.projectId)); event.preventDefault(); return;
  }
  if(event.key === 'Enter' && !projectSearchComposing && !event.isComposing && event.keyCode !== 229){
    if(activeProjectId !== null){ selectProjectFromPicker(activeProjectId); event.preventDefault(); }
  }
});
projectSearchClearButton.addEventListener('click',function(){ projectSearchQuery=''; projectSearchInput.value=''; renderProjectSelect(true); projectSearchInput.focus(); });
projectListbox.addEventListener('mousedown',function(event){ if(isElement(event.target) && event.target.closest('[role="option"]')) event.preventDefault(); });
projectListbox.addEventListener('click',function(event){
  if(!isElement(event.target)) return;
  const option=event.target.closest('[role="option"]');
  if(option && projectListbox.contains(option)) selectProjectFromPicker(Number(option.dataset.projectId));
});
projectPicker.addEventListener('focusout',function(event){
  const next=event.relatedTarget;
  if(next){ if(!projectPicker.contains(next)) closeProjectPicker(false); return; }
  window.setTimeout(function(){ if(projectPickerOpen && !projectPicker.contains(document.activeElement)) closeProjectPicker(false); },0);
});
projectPickerPopup.addEventListener('keydown',function(event){
  if(event.key === 'Escape' && !projectSearchComposing && !event.isComposing && event.keyCode !== 229){ closeProjectPicker(true); event.preventDefault(); }
});
`,
  dismissal: String.raw`document.addEventListener('click',function(event){ if(projectPickerOpen && (!isElement(event.target) || !projectPicker.contains(event.target))) closeProjectPicker(false); });
document.addEventListener('scroll',function(event){ if(projectPickerOpen && !projectPickerPopup.contains(event.target)) closeProjectPicker(false); },true);
window.addEventListener('resize',function(){ if(projectPickerOpen) closeProjectPicker(false); });
`,
  rendering: String.raw`// ── Render and extension messages ─────────────────────────────────────────
function normalizeProjectSearch(value){ return String(value ?? '').normalize('NFKC').toLowerCase().trim(); }
function deriveVisibleProjects(projects){
  const projectById=new Map(projects.map(function(project){ return [project.id,project]; }));
  const query=normalizeProjectSearch(projectSearchQuery);
  const visibleIds=new Set();
  const walkedAncestors=new Set();
  const matches=[];
  function includeProjectAndAncestors(project){
    let current=project;
    while(current && !walkedAncestors.has(current.id)){
      walkedAncestors.add(current.id);
      visibleIds.add(current.id);
      current=current.parentId === undefined ? undefined : projectById.get(current.parentId);
    }
  }
  if(!query){ projects.forEach(function(project){ visibleIds.add(project.id); }); }
  else {
    projects.forEach(function(project){
      const searchable=normalizeProjectSearch((project.name || '')+' '+(project.identifier || ''));
      if(searchable.includes(query)){ matches.push(project); includeProjectAndAncestors(project); }
    });
  }
  const resultIds=new Set(visibleIds);
  const selectedId=state?.selectedProject?.id;
  if(selectedId !== undefined){ const selectedProject=projectById.get(selectedId); if(selectedProject) includeProjectAndAncestors(selectedProject); }
  return { projects:projects.filter(function(project){ return visibleIds.has(project.id); }), matches:matches, resultIds:resultIds };
}
function setActiveProject(projectId){
  activeProjectId=projectId;
  const options=projectListbox.querySelectorAll('[role="option"]');
  options.forEach(function(option){
    const active=Number(option.dataset.projectId)===activeProjectId;
    option.classList.toggle('project-option-active',active);
  });
  if(projectPickerOpen && activeProjectId !== null && document.getElementById('project-option-'+activeProjectId)) projectSearchInput.setAttribute('aria-activedescendant','project-option-'+activeProjectId);
  else projectSearchInput.removeAttribute('aria-activedescendant');
  ensureActiveProjectVisible();
}
function ensureActiveProjectVisible(){
  if(!projectPickerOpen || activeProjectId===null) return;
  const option=document.getElementById('project-option-'+activeProjectId);
  if(!option) return;
  const listBounds=projectListbox.getBoundingClientRect();
  const optionBounds=option.getBoundingClientRect();
  if(optionBounds.top<listBounds.top) projectListbox.scrollTop-=listBounds.top-optionBounds.top;
  else if(optionBounds.bottom>listBounds.bottom) projectListbox.scrollTop+=optionBounds.bottom-listBounds.bottom;
}
function updateProjectPickerPosition(){
  if(!projectPickerOpen) return;
  const anchor=projectSelectTrigger.getBoundingClientRect();
  const margin=8;
  const width=Math.min(Math.max(anchor.width,260),Math.max(0,window.innerWidth-margin*2));
  projectPickerPopup.style.width=width+'px';
  projectPickerPopup.style.left=Math.max(margin,Math.min(anchor.left,window.innerWidth-width-margin))+'px';
  const below=window.innerHeight-anchor.bottom-margin;
  const above=anchor.top-margin;
  const openBelow=below>=above || below>=Math.min(projectPickerPopup.scrollHeight,220);
  const available=Math.max(0,Math.min(320,openBelow?below:above));
  projectPickerPopup.style.maxHeight=available+'px';
  const height=projectPickerPopup.getBoundingClientRect().height;
  projectPickerPopup.style.top=(openBelow ? Math.min(anchor.bottom+4,window.innerHeight-height-margin) : Math.max(margin,anchor.top-height-4))+'px';
  ensureActiveProjectVisible();
}
function closeProjectPicker(returnFocus){
  projectPickerOpen=false;
  projectSearchQuery='';
  projectSearchInput.value='';
  projectSearchComposing=false;
  activeProjectId=null;
  projectPickerPopup.hidden=true;
  projectSelectTrigger.setAttribute('aria-expanded','false');
  projectSearchInput.setAttribute('aria-expanded','false');
  projectSearchInput.removeAttribute('aria-activedescendant');
  renderProjectSelect(false);
  if(returnFocus) projectSelectTrigger.focus();
}
function openProjectPicker(){
  closeLayoutPopover();
  projectPickerOpen=true;
  projectSearchQuery='';
  projectSearchInput.value='';
  projectPickerPopup.hidden=false;
  projectSelectTrigger.setAttribute('aria-expanded','true');
  projectSearchInput.setAttribute('aria-expanded','true');
  renderProjectSelect(true);
  updateProjectPickerPosition();
  projectSearchInput.focus();
}
function selectProjectFromPicker(projectId){
  if(!Number.isSafeInteger(projectId) || projectId<0) return;
  if(projectId !== (state?.selectedProject?.id ?? 0)){
    if(searchTimer){ window.clearTimeout(searchTimer); searchTimer=null; }
    if(projectId === 0) req('project.selectAll',{query:searchInput.value});
    else req('project.select',{projectId:projectId,query:searchInput.value});
  }
  closeProjectPicker(true);
}
function renderProjectSelect(resetActive){
  const projects=[{id:0,name:STRINGS.selectProjectPlaceholder,level:0},...(state?.projects || [])];
  const projection=deriveVisibleProjects(projects);
  const selectedId=state?.selectedProject?.id ?? 0;
  const selectedProject=projects.find(function(project){ return project.id===selectedId; });
  projectSelectLabel.textContent=selectedProject?.name || state?.selectedProject?.name || STRINGS.selectProjectPlaceholder;
  projectSelectTrigger.title=selectedProject?.name || state?.selectedProject?.name || STRINGS.selectProjectTitle;
  projectListbox.replaceChildren();
  const searching=normalizeProjectSearch(projectSearchQuery).length>0;
  const groups=new Map();
  function projectGroup(inResults){
    if(!searching) return projectListbox;
    const key=inResults ? 'results' : 'selected';
    if(!groups.has(key)){
      const group=document.createElement('div'); group.setAttribute('role','group');
      const label=document.createElement('div'); label.className='project-group-label'; label.id='project-group-'+key;
      label.textContent=inResults ? STRINGS.projectSearchResults : STRINGS.projectSelectedOutsideSearch;
      group.setAttribute('aria-labelledby',label.id); group.appendChild(label); groups.set(key,group); projectListbox.appendChild(group);
    }
    return groups.get(key);
  }
  const orderedProjects=projection.projects.slice().sort(function(a,b){ return Number(projection.resultIds.has(b.id))-Number(projection.resultIds.has(a.id)); });
  orderedProjects.forEach(function(project){
    const option=document.createElement('div');
    option.id='project-option-'+project.id;
    option.className='project-option';
    option.setAttribute('role','option');
    option.setAttribute('aria-selected',String(project.id===selectedId));
    option.dataset.projectId=String(project.id);
    option.style.paddingInlineStart=(8+Math.max(0,project.level || 0)*16)+'px';
    const copy=document.createElement('span'); copy.className='project-option-copy';
    const name=document.createElement('span'); name.className='project-option-name'; name.textContent=project.name || (STRINGS.projectLabel+' #'+project.id);
    const identifier=document.createElement('span'); identifier.className='project-option-identifier'; identifier.textContent=project.identifier || '';
    copy.appendChild(name); if(identifier.textContent) copy.appendChild(identifier);
    option.appendChild(copy);
    if(project.id===selectedId){ const check=document.createElement('span'); check.className='project-option-check'; check.setAttribute('aria-hidden','true'); check.textContent='✓'; option.appendChild(check); }
    projectGroup(projection.resultIds.has(project.id)).appendChild(option);
  });
  projectSearchClearButton.hidden=projectSearchQuery.length===0;
  document.getElementById('project-search-empty').hidden=normalizeProjectSearch(projectSearchQuery).length===0 || projection.matches.length>0;
  if(projectPickerOpen){
    const visibleIds=new Set(projection.projects.map(function(project){ return project.id; }));
    if(resetActive){
      activeProjectId=normalizeProjectSearch(projectSearchQuery).length>0 ? (projection.matches[0]?.id ?? null) : (selectedId !== undefined && visibleIds.has(selectedId) ? selectedId : (projection.projects[0]?.id ?? null));
    } else if(activeProjectId===null || !visibleIds.has(activeProjectId)){
      activeProjectId=normalizeProjectSearch(projectSearchQuery).length>0 ? (projection.matches[0]?.id ?? null) : (selectedId !== undefined && visibleIds.has(selectedId) ? selectedId : (projection.projects[0]?.id ?? null));
    }
  } else activeProjectId=null;
  setActiveProject(activeProjectId);
  if(projectPickerOpen) updateProjectPickerPosition();
}
`,
};
