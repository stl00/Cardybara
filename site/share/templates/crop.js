// Fills every [data-shot] with part of a real screenshot: data-shot="file", data-crop="x,y,width" in screenshot pixels.
// The crop is scaled to the element's width; the element's height decides how much shows below y.
document.querySelectorAll('[data-shot]').forEach(el=>{
 const [x,y,w]=el.dataset.crop.split(',').map(Number),img=new Image();
 img.onload=()=>{const k=el.clientWidth/w;el.style.backgroundImage=`url(${img.src})`;el.style.backgroundSize=`${img.naturalWidth*k}px auto`;el.style.backgroundPosition=`${-x*k}px ${-y*k}px`;el.dataset.ready='1';};
 img.src='../../assets/shots/'+el.dataset.shot;
});
