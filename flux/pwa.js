(function(){
  var status=document.getElementById('pwa-status');
  function show(){status.textContent=navigator.onLine?'Pronto para uso offline neste dispositivo.':'Sem conexão • trabalhando com os dados deste dispositivo.'}
  if(!('serviceWorker' in navigator)||!window.isSecureContext){status.textContent='Para instalar e habilitar o modo offline, abra este sistema por HTTPS.';return}
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'}).then(function(reg){
      function updateNotice(){status.textContent='Atualização disponível. Feche todas as janelas do FluX e abra novamente para aplicar.'}
      if(reg.waiting)updateNotice();
      reg.addEventListener('updatefound',function(){var worker=reg.installing;worker.addEventListener('statechange',function(){if(worker.state==='installed'&&navigator.serviceWorker.controller)updateNotice()})});
      navigator.serviceWorker.ready.then(function(){if(!reg.waiting)show()});
      window.addEventListener('online',function(){if(!reg.waiting)show()});window.addEventListener('offline',show);
    }).catch(function(){status.textContent='Não foi possível preparar o modo offline. Conecte-se e abra novamente.'});
  });
})();
