import {applicationUrl,products} from './config.js';

for(const link of document.querySelectorAll('[data-app-link]'))link.href=applicationUrl(location.href);
for(const list of document.querySelectorAll('[data-products]')){
  for(const product of products){
    const link=document.createElement('a');link.href=product.href;link.className='product-link';
    const category=document.createElement('span');category.className='eyebrow';category.textContent=product.category;
    const title=document.createElement('h3');title.textContent=product.name;
    const description=document.createElement('p');description.textContent=product.description;
    const arrow=document.createElement('span');arrow.className='product-arrow';arrow.textContent=`Explore ${product.name}`;
    link.append(category,title,description,arrow);list.append(link);
  }
}
const menu=document.querySelector('#menu-toggle'),nav=document.querySelector('#site-navigation');
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('is-open',open);});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && nav?.classList.contains('is-open')){menu.setAttribute('aria-expanded','false');nav.classList.remove('is-open');menu.focus();}});
for(const link of nav?.querySelectorAll('a') || [])link.addEventListener('click',()=>{menu.setAttribute('aria-expanded','false');nav.classList.remove('is-open');});
