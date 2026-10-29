const SOURCES = /* PAGE_SOURCES */ Array.from({length:32},(_,i)=>`pages/${String(i+1).padStart(2,'0')}.jpg`);
const $=id=>document.getElementById(id);
const book=$('book'),original=$('original');
const paper=new SoftPaperTurn($('paperCanvas'),$('pageShadow'));
let current=0,turn=null,pointer=null,clickTimer=null,zoom=1;
const cache=new Map();
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
function preload(i){
 if(i<0||i>=SOURCES.length)return Promise.resolve();
 if(!cache.has(i))cache.set(i,new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>{cache.delete(i);reject(new Error('页面暂时无法加载，请重试。'))};im.src=SOURCES[i];}));
 return cache.get(i);
}
function announce(message){$('status').textContent=message;}
function fit(){const stage=document.querySelector('.stage'),s=getComputedStyle(stage);const w=stage.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),h=stage.clientHeight-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom);book.style.width=`${Math.max(1,Math.min(w,h*5692/3202))}px`;if(turn&&turn.ready){paper.resize();paper.draw(turn.progress);}}
new ResizeObserver(fit).observe(document.querySelector('.stage'));
function update(){
 original.src=SOURCES[current];original.alt=`HOSEN TWO EIGHT 画册第 ${current+1} 页`;
 $('pageInput').value=current+1;
 $('prevButton').disabled=$('leftZone').disabled=current===0;
 $('nextButton').disabled=$('rightZone').disabled=current===SOURCES.length-1;
 document.querySelectorAll('.thumb').forEach((el,i)=>el.setAttribute('aria-current',i===current?'page':'false'));
 preload(current+1).catch(()=>{});preload(current-1).catch(()=>{});
}
async function prepare(target){
 if(turn||target===current||target<0||target>=SOURCES.length)return false;
 const dir=target>current?1:-1;
 turn={target,dir,progress:0,ready:false,settling:false};
 try{
  if(!cache.has(target))announce('正在准备页面…');
  const images=await Promise.all([preload(current),preload(target)]);
  $('staticLeft').src=SOURCES[dir>0?current:target];$('staticRight').src=SOURCES[dir>0?target:current];
  paper.setImages(images[0],images[1],dir,pointer?pointer.grab:.78);
  book.classList.add('turning');turn.ready=true;setProgress(0);announce('');return true;
 }catch(e){turn=null;announce(e.message);return false;}
}
function setProgress(p){if(!turn||!turn.ready)return;turn.progress=Math.max(0,Math.min(1,p));paper.draw(turn.progress);}
function settle(commit){
 if(!turn||!turn.ready||turn.settling)return Promise.resolve();
 turn.settling=true;
 const active=turn,from=turn.progress,to=commit?1:0;
 const duration=reducedMotion.matches?0:Math.max(240,1180*Math.abs(to-from));
 return new Promise(resolve=>{const start=performance.now();function step(now){const t=duration?Math.min(1,(now-start)/duration):1;const eased=t*t*t*(t*(t*6-15)+10);setProgress(from+(to-from)*eased);if(t<1){requestAnimationFrame(step);return}if(commit)current=active.target;update();book.classList.remove('turning');turn=null;resolve();}requestAnimationFrame(step);});
}
async function go(target){if(pointer||turn)return;if(await prepare(target))await settle(true);}
$('prevButton').onclick=()=>go(current-1);$('nextButton').onclick=()=>go(current+1);
function jumpFromInput(){const value=Number($('pageInput').value);const target=Number.isFinite(value)?Math.max(0,Math.min(31,Math.round(value)-1)):current;$('pageInput').value=current+1;go(target);}
$('pageInput').addEventListener('change',jumpFromInput);
$('pageInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();jumpFromInput();$('pageInput').blur();}});
function zoneClick(dir,e){if(e.detail===0){go(current+dir);return}if(e.detail>1)return;clearTimeout(clickTimer);clickTimer=setTimeout(()=>go(current+dir),210);}
$('leftZone').onclick=e=>zoneClick(-1,e);$('rightZone').onclick=e=>zoneClick(1,e);
book.addEventListener('dblclick',()=>{clearTimeout(clickTimer);if(!turn)openZoom();});
book.addEventListener('pointerdown',e=>{if(turn||!e.isPrimary||e.button!==0)return;const rect=book.getBoundingClientRect(),dir=e.clientX>rect.left+rect.width/2?1:-1;if(current+dir<0||current+dir>=SOURCES.length)return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,width:rect.width,grab:Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height)),dir,drag:false,pending:false};});
book.addEventListener('pointermove',async e=>{
 if(!pointer||pointer.id!==e.pointerId)return;
 pointer.lastX=e.clientX;
 const dx=(pointer.x-e.clientX)*pointer.dir;
 if(!pointer.drag&&dx>8&&dx>Math.abs(pointer.y-e.clientY)){
  pointer.drag=true;pointer.pending=true;clearTimeout(clickTimer);book.setPointerCapture(e.pointerId);const p=pointer;
  const ready=await prepare(current+p.dir);
  p.pending=false;
  if(pointer===p&&ready)setProgress((p.x-p.lastX)*p.dir/(p.width*.8));
  else if(ready)settle(false);
 }
 if(pointer&&pointer.drag&&!pointer.pending&&turn&&!turn.settling)setProgress((pointer.x-e.clientX)*pointer.dir/(pointer.width*.8));
});
function release(e,cancel=false){
 if(!pointer||pointer.id!==e.pointerId)return;const p=pointer;pointer=null;
 if(p.drag){book.addEventListener('click',event=>{event.stopImmediatePropagation();event.preventDefault();},{capture:true,once:true});if(book.hasPointerCapture(e.pointerId))book.releasePointerCapture(e.pointerId);if(turn&&turn.ready)settle(!cancel&&turn.progress>.18);}
}
window.addEventListener('pointerup',e=>release(e));window.addEventListener('pointercancel',e=>release(e,true));
document.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]')||/INPUT|TEXTAREA/.test(e.target.tagName)||e.altKey||e.ctrlKey||e.metaKey)return;if(['ArrowRight','ArrowLeft','Home','End',' '].includes(e.key)){e.preventDefault();if(e.key==='Home')go(0);else if(e.key==='End')go(31);else go(current+(['ArrowRight',' '].includes(e.key)?1:-1));}});
$('contentsButton').onclick=()=>{
 if(!$('thumbs').children.length)SOURCES.forEach((src,i)=>{const button=document.createElement('button');button.className='thumb';button.setAttribute('aria-label',`跳转到第 ${i+1} 页`);button.setAttribute('aria-current',i===current?'page':'false');const img=document.createElement('img');img.src=src;img.loading='lazy';img.alt=`第 ${i+1} 页缩略图`;const span=document.createElement('span');span.textContent=String(i+1).padStart(2,'0');button.append(img,span);button.onclick=()=>{$('contentsDialog').close();go(i);};$('thumbs').append(button);});
 $('contentsDialog').showModal();
};
function renderZoom(){ $('zoomImage').style.width=`${zoom*100}%`;$('zoomCount').textContent=`${Math.round(zoom*100)}%`;$('zoomOut').disabled=zoom<=1;$('zoomIn').disabled=zoom>=3;}
function openZoom(){zoom=1;$('zoomImage').src=SOURCES[current];$('zoomImage').alt=`HOSEN TWO EIGHT 画册第 ${current+1} 页放大视图`;renderZoom();$('zoomDialog').showModal();$('zoomBody').scrollTo(0,0);}
$('zoomButton').onclick=openZoom;$('zoomIn').onclick=()=>{zoom=Math.min(3,zoom+.5);renderZoom()};$('zoomOut').onclick=()=>{zoom=Math.max(1,zoom-.5);renderZoom()};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}}));
$('fullscreenButton').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else announce('此浏览器不支持全屏，可使用浏览器菜单放大。');}catch{announce('请使用浏览器的全屏功能。');}};
document.addEventListener('fullscreenchange',()=>{$('fullscreenButton').textContent=document.fullscreenElement?'退出全屏':'全屏';fit();});
update();fit();
