// Bascule français / anglais. La langue du navigateur décide au premier affichage,
// le choix est mémorisé sur l'appareil seulement.
(function(){
  var boutons = document.querySelectorAll('.langues button');
  var blocs = { fr: document.getElementById('fr'), en: document.getElementById('en') };
  function montrer(l){
    for (var k in blocs){ blocs[k].hidden = (k !== l); }
    boutons.forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.lang === l ? 'true' : 'false'); });
    document.documentElement.lang = l;
    try { localStorage.setItem('duelio_legal_lang', l); } catch(e){}
  }
  var choix = null;
  try { choix = localStorage.getItem('duelio_legal_lang'); } catch(e){}
  if (choix !== 'fr' && choix !== 'en'){
    var hash = location.hash.replace('#','');
    choix = (hash === 'en' || hash === 'fr') ? hash : (/^fr/i.test(navigator.language || '') ? 'fr' : 'en');
  }
  montrer(choix);
  boutons.forEach(function(b){ b.addEventListener('click', function(){ montrer(b.dataset.lang); }); });
})();
