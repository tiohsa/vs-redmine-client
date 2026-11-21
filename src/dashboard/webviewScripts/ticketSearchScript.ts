export const ticketSearchScript = {
  controls: String.raw`const searchInput = document.getElementById('search-input');
const searchClearButton = document.getElementById('search-clear-btn');
`,
  actions: String.raw`function updateSearchClearButton(){ searchClearButton.classList.toggle('hidden', !searchInput.value); }
function submitSearch(){
  if(searchTimer){ window.clearTimeout(searchTimer); searchTimer=null; }
  if(searchComposing) return;
  searchQuery=searchInput.value.trim();
  req('tickets.search',{query:searchQuery,scope:state?.selectedProject ? {kind:'project',projectId:state.selectedProject.id} : {kind:'all'}});
}
function clearSearch(){
  searchInput.value=''; searchQuery=''; searchComposing=false;
  updateSearchClearButton(); submitSearch(); searchInput.focus();
}
function scheduleSearch(){
  searchQuery=searchInput.value.trim(); updateSearchClearButton();
  if(searchTimer){ window.clearTimeout(searchTimer); searchTimer=null; }
  if(!searchComposing) searchTimer=window.setTimeout(submitSearch,150);
}
searchInput.addEventListener('input',scheduleSearch);
searchInput.addEventListener('compositionstart',function(){ searchComposing=true; if(searchTimer){ window.clearTimeout(searchTimer); searchTimer=null; } });
searchInput.addEventListener('compositionend',function(){ searchComposing=false; scheduleSearch(); });
searchClearButton.addEventListener('click',clearSearch);
searchInput.addEventListener('keydown',function(event){
  if(searchComposing || event.isComposing || event.keyCode === 229) return;
  if(event.key === 'Enter'){ submitSearch(); event.preventDefault(); }
  else if(event.key === 'Escape' && this.value){ clearSearch(); event.preventDefault(); event.stopPropagation(); }
});
`,
};
