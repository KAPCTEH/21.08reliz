'use strict';

const form=document.getElementById('form');
const password=document.getElementById('password');
const status=document.getElementById('status');
const submit=document.getElementById('submit');

document.getElementById('toggle').addEventListener('click',()=>{
  password.type=password.type==='password'?'text':'password';
  password.focus();
});
document.getElementById('cancel').addEventListener('click',()=>window.JustFunRegVpsSetup.cancel());
form.addEventListener('submit',async event=>{
  event.preventDefault();
  status.textContent='';
  if(!password.value){status.textContent='Введите SSH-пароль.';password.focus();return}
  submit.disabled=true;
  submit.textContent='Подключение…';
  try{
    const result=await window.JustFunRegVpsSetup.submit(password.value);
    password.value='';
    if(!result?.ok){status.textContent=result?.error||'Не удалось передать пароль.';submit.disabled=false;submit.textContent='Продолжить'}
  }catch(error){
    password.value='';
    status.textContent=error?.message||'Не удалось передать пароль.';
    submit.disabled=false;
    submit.textContent='Продолжить';
  }
});
