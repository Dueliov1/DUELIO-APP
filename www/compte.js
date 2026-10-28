/* Comptes utilisateurs — Firebase Authentication + Firestore.
 *
 * Tout est optionnel : sans fichier firebase-config.json (ou s'il est vide), aucun
 * bouton de compte n'apparaît et l'application fonctionne exactement comme avant.
 * Le SDK Firebase n'est chargé qu'à ce moment-là, depuis le CDN de Google.
 *
 * Ce que le compte apporte : retrouver ses duels sauvegardés sur n'importe quel
 * appareil. Ce qui est stocké chez Firebase : l'adresse e-mail, l'identifiant du
 * compte, la date de création, et les duels (nom + identifiants des joueurs).
 *
 * Structure Firestore : users/{uid}/duels/{id} = { name, playerIds, createdAt }.
 * Règles (à coller dans Firestore → Règles) :
 *   rules_version = '2';
 *   service cloud.firestore {
 *     match /databases/{database}/documents {
 *       match /users/{uid}/{document=**} {
 *         allow read, write: if request.auth != null && request.auth.uid == uid;
 *       }
 *     }
 *   }
 *
 * Dans l'application iOS/Android, Google et Apple passent par le plugin natif
 * @capacitor-firebase/authentication (les fenêtres surgissantes ne marchent pas
 * dans une WebView) ; sur le web, par les fenêtres de Firebase.
 */
(function(){
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/11.6.1/';
  const etat = { pret: false, dispo: false, user: null, duels: [], config: null, fb: null, erreur: null };
  const abonnes = new Set();
  function prevenir(){ abonnes.forEach(f => { try{ f(etat); }catch(e){} }); }

  function natif(){ const C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); }
  function pluginNatif(){ const C = window.Capacitor; return natif() && C.Plugins && C.Plugins.FirebaseAuthentication || null; }

  async function charger(){
    if(etat.pret) return etat.dispo;
    try{
      const r = await fetch('firebase-config.json', { cache: 'no-store' });
      const cfg = r.ok ? await r.json() : null;
      if(!cfg || !cfg.apiKey || !cfg.projectId){ etat.pret = true; return false; }
      etat.config = cfg;
      // Les tests peuvent fournir un Firebase simulé sous window.__firebaseSimule.
      const fb = window.__firebaseSimule || await chargerSdk();
      etat.fb = fb;
      fb.onAuthStateChanged(async (u)=>{
        etat.user = u ? { uid: u.uid, email: u.email || '', verifie: !!u.emailVerified, fournisseur: (u.providerData && u.providerData[0] && u.providerData[0].providerId) || 'password' } : null;
        etat.duels = [];
        if(etat.user){ try{ etat.duels = await fb.listerDuels(u.uid); }catch(e){ console.warn('duels :', e && e.message); } }
        prevenir();
      });
      etat.dispo = true; etat.pret = true;
      prevenir();
      return true;
    }catch(e){
      console.warn('compte indisponible :', e && e.message);
      etat.erreur = e; etat.pret = true; prevenir();
      return false;
    }
  }

  async function chargerSdk(){
    const [app, auth, fs] = await Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')
    ]);
    const a = app.initializeApp(etat.config);
    const authI = auth.getAuth(a);
    try{ authI.languageCode = 'fr'; }catch(e){}
    const db = fs.getFirestore(a);
    const col = (uid)=> fs.collection(db, 'users', uid, 'duels');
    return {
      onAuthStateChanged: (f)=> auth.onAuthStateChanged(authI, f),
      utilisateur: ()=> authI.currentUser,
      async inscrire(email, mdp){
        const cred = await auth.createUserWithEmailAndPassword(authI, email, mdp);
        try{ await auth.sendEmailVerification(cred.user); }catch(e){}
        await fs.setDoc(fs.doc(db, 'users', cred.user.uid), { email, createdAt: fs.serverTimestamp() }, { merge: true });
        return cred.user;
      },
      connecter: (email, mdp)=> auth.signInWithEmailAndPassword(authI, email, mdp).then(c => c.user),
      motDePasseOublie: (email)=> auth.sendPasswordResetEmail(authI, email),
      renvoyerVerification: ()=> authI.currentUser ? auth.sendEmailVerification(authI.currentUser) : Promise.resolve(),
      async google(){
        const pn = pluginNatif();
        if(pn){
          const r = await pn.signInWithGoogle({ skipNativeAuth: true });
          const cred = auth.GoogleAuthProvider.credential(r.credential && r.credential.idToken, r.credential && r.credential.accessToken);
          return (await auth.signInWithCredential(authI, cred)).user;
        }
        const p = new auth.GoogleAuthProvider();
        return (await auth.signInWithPopup(authI, p)).user;
      },
      async apple(){
        const pn = pluginNatif();
        if(pn){
          const r = await pn.signInWithApple({ skipNativeAuth: true });
          const prov = new auth.OAuthProvider('apple.com');
          const cred = prov.credential({ idToken: r.credential && r.credential.idToken, rawNonce: r.credential && r.credential.nonce });
          return (await auth.signInWithCredential(authI, cred)).user;
        }
        const p = new auth.OAuthProvider('apple.com');
        p.addScope('email'); p.addScope('name');
        return (await auth.signInWithPopup(authI, p)).user;
      },
      async deconnecter(){
        const pn = pluginNatif(); if(pn){ try{ await pn.signOut(); }catch(e){} }
        return auth.signOut(authI);
      },
      async listerDuels(uid){
        const q = fs.query(col(uid), fs.orderBy('createdAt', 'desc'), fs.limit(100));
        const snap = await fs.getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      },
      async ajouterDuel(uid, name, playerIds){
        const ref = await fs.addDoc(col(uid), { name, playerIds, createdAt: fs.serverTimestamp() });
        return ref.id;
      },
      supprimerDuel: (uid, id)=> fs.deleteDoc(fs.doc(db, 'users', uid, 'duels', id)),
      async supprimerCompte(mdp){
        const u = authI.currentUser; if(!u) return;
        // Firebase exige une connexion récente : on redemande le mot de passe, ou le fournisseur.
        try{
          if(mdp && u.email) await auth.reauthenticateWithCredential(u, auth.EmailAuthProvider.credential(u.email, mdp));
        }catch(e){ throw new Error('Mot de passe incorrect.'); }
        const snap = await fs.getDocs(col(u.uid));
        await Promise.all(snap.docs.map(d => fs.deleteDoc(d.ref)));
        try{ await fs.deleteDoc(fs.doc(db, 'users', u.uid)); }catch(e){}
        try{ await auth.deleteUser(u); }
        catch(e){
          if(e && /requires-recent-login/.test(e.code || '')) throw new Error('Par sécurité, reconnectez-vous puis réessayez la suppression.');
          throw e;
        }
        const pn = pluginNatif(); if(pn){ try{ await pn.signOut(); }catch(e){} }
      }
    };
  }

  // Messages en français pour les codes d'erreur Firebase les plus courants.
  function messageErreur(e){
    const code = (e && e.code) || '';
    const t = {
      'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse.',
      'auth/invalid-email': 'Adresse e-mail invalide.',
      'auth/weak-password': 'Mot de passe trop court : 6 caractères au minimum.',
      'auth/user-not-found': 'Aucun compte avec cette adresse.',
      'auth/wrong-password': 'Mot de passe incorrect.',
      'auth/invalid-credential': 'Adresse ou mot de passe incorrect.',
      'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.',
      'auth/network-request-failed': 'Pas de connexion. Vérifiez votre réseau.',
      'auth/popup-closed-by-user': 'Connexion annulée.',
      'auth/cancelled-popup-request': 'Connexion annulée.',
      'auth/popup-blocked': 'Votre navigateur a bloqué la fenêtre de connexion.',
      'auth/operation-not-allowed': 'Cette méthode de connexion n\'est pas activée.',
      'auth/requires-recent-login': 'Par sécurité, reconnectez-vous puis réessayez.',
    };
    return t[code] || (e && e.message && !/firebase/i.test(e.message) ? e.message : 'Une erreur est survenue. Réessayez.');
  }

  window.Compte = {
    etat, charger, abonner: (f)=>{ abonnes.add(f); return ()=> abonnes.delete(f); },
    messageErreur,
    natif,
    appleDisponible: ()=> !!(etat.config && (etat.config.apple === true || pluginNatif())),
    googleDisponible: ()=> !!(etat.config && etat.config.google !== false),
    async inscrire(email, mdp){ return etat.fb.inscrire(email.trim(), mdp); },
    async connecter(email, mdp){ return etat.fb.connecter(email.trim(), mdp); },
    async motDePasseOublie(email){ return etat.fb.motDePasseOublie(email.trim()); },
    async renvoyerVerification(){ return etat.fb.renvoyerVerification(); },
    async google(){ return etat.fb.google(); },
    async apple(){ return etat.fb.apple(); },
    async deconnecter(){ return etat.fb.deconnecter(); },
    async sauvegarderDuel(name, playerIds){
      if(!etat.user) throw new Error('non connecté');
      const id = await etat.fb.ajouterDuel(etat.user.uid, name, playerIds);
      etat.duels.unshift({ id, name, playerIds, createdAt: new Date() }); prevenir();
      return id;
    },
    async supprimerDuel(id){
      if(!etat.user) return;
      await etat.fb.supprimerDuel(etat.user.uid, id);
      etat.duels = etat.duels.filter(d => d.id !== id); prevenir();
    },
    async supprimerCompte(mdp){ return etat.fb.supprimerCompte(mdp); }
  };
})();
