# Transparence

Tu installes un exécutable. Tu as le droit de savoir exactement ce qu'il fait.
Ce document est la référence ; le code est dans `src/`, et il est public.

## Ce que le launcher fait

- Affiche un launcher où tu te connectes **ou crées ton compte Big Street**.
  Pseudo, mot de passe, e-mail et code de parrainage partent directement au
  site du jeu (`/api/login`, `/api/register`), à personne d'autre. Le mot de
  passe n'est jamais écrit sur ton disque : seul le jeton de session l'est.
- **Google et Twitch** s'ouvrent dans **ton navigateur habituel**, jamais dans
  une fenêtre du launcher : tu vois la vraie adresse et le vrai cadenas. Le
  site te renvoie ensuite à l'application par un lien `bigstreet://`. Le
  launcher ne voit jamais ton mot de passe Google ou Twitch.
- **Connexion sans mot de passe** : donne ton adresse, reçois un code à six
  chiffres valable 10 minutes, utilisable une seule fois.
- Les e-mails (codes d'inscription et de connexion) partent du serveur du jeu
  via Resend, depuis `no-reply@playbigstreet.com`. Le launcher, lui, n'envoie
  aucun e-mail : il ne fait que transmettre ton adresse au site.
- Ouvre ensuite `https://playbigstreet.com/` dans une fenêtre Chromium (Electron).
- Affiche un écran de chargement pendant la connexion.
- Renvoie les liens externes vers ton navigateur habituel.
- Vérifie au démarrage s'il existe une version plus récente **du launcher**
  sur les releases GitHub de ce dépôt.
- Si oui : la télécharge et redémarre **tout seul, au lancement**, avant
  d'ouvrir le jeu. Jamais en pleine partie. Il n'y a volontairement ni
  bouton ni question : le launcher est toujours à jour.
- Le **jeu**, lui, se recharge à la demande avec le bouton ⟳ en bas à droite.
- **Icônes cachées et démarrage avec Windows** : Big Street a son icône près
  de l'horloge. Fermer la fenêtre l'y range, et seul « Quitter Big Street »
  (clic droit sur l'icône) l'arrête vraiment. Par défaut, il démarre avec
  Windows, discrètement, dans les icônes cachées, sans ouvrir de fenêtre. Pour
  ça, il crée une entrée « Big Street » dans les applications de démarrage
  (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), visible dans le
  Gestionnaire des tâches. Tu peux le désactiver dans Options ou dans le menu
  de l'icône. La désinstallation retire cette entrée et la préférence de carte
  graphique.
- **Demandes d'amis** : l'onglet Amis montre les demandes reçues (sur le site
  ou en jeu) et permet de les accepter ou de les refuser. Tant que le launcher
  est ouvert et que tu n'es pas en jeu, il regarde toutes les 30 secondes s'il
  y en a une nouvelle et te l'annonce par une notification Windows (Accepter,
  Refuser, Ignorer). Chaque notification porte un jeton tiré au hasard : un lien
  `bigstreet://friend` qui ne le porte pas, venu d'une page web par exemple, est
  ignoré. « Ignorer » laisse la demande en attente dans l'onglet Amis.
- Embarque la bibliothèque **OpenRGB SDK** (MIT), prévue pour colorer plus tard
  l'éclairage du clavier selon ce qui se passe en jeu. **Elle n'est pas
  utilisée pour l'instant** : le launcher ne se connecte à rien avec.
- Écrit un journal local, sur ta machine uniquement
  (`%APPDATA%\Big Street\logs\main.log`).
- Affiche dans **Options** la version installée, la dernière version publiée,
  et un bouton **Désinstaller le launcher** : il lance le désinstalleur de
  Windows, celui-là même que tu trouverais dans Paramètres > Applications.
  Ton compte et ta progression ne sont pas touchés : ils sont sur le serveur.

## Ce que le launcher ne fait pas

- **Aucune télémétrie**, aucune statistique d'usage, aucun traçage.
- **Aucune collecte** de données personnelles. Il n'envoie rien nulle part,
  à part les requêtes vers le site du jeu et la vérification de version GitHub.
- **Ton jeton de session est chiffré** par le coffre de Windows (DPAPI) dans
  `settings.json`, et le fichier est écrit en lecture pour toi seul. Ton mot de
  passe, lui, n'est jamais écrit nulle part.
- **Un retour de connexion n'est accepté que s'il répond à une demande que tu
  viens de faire** : le launcher tire un jeton à usage unique avant d'ouvrir ton
  navigateur, et refuse tout lien `bigstreet://` qui ne le porte pas. Une page
  web ne peut donc pas te connecter sur un compte qui n'est pas le tien.
- **Aucun identifiant embarqué** : il ne contient ni clé, ni jeton, ni secret.
  Les mises à jour sont publiques et anonymes, vérifie-le toi-même.
- **Aucun accès à tes fichiers**, hors son propre dossier d'installation et de
  journal. Le rendu web tourne en bac à sable (`sandbox: true`,
  `nodeIntegration: false`, `contextIsolation: true`).
- Il **ne touche à rien d'autre** que son propre dossier, avec deux
  exceptions : l'entrée de démarrage avec Windows (voir plus haut), et sous Windows, il règle Big Street en « Hautes performances »
  dans Paramètres > Affichage > Graphiques (clé
  `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`), pour que le jeu
  tourne sur ta carte graphique dédiée. Une fois, et jamais si tu as déjà fait
  ce choix toi-même. Tu peux le changer à tout moment au même endroit. Seule
  l'application elle-même est mise à jour, jamais le reste de ta machine.

## Les personnages affichés

Les personnages de l'écran d'accueil et du choix de départ ne sont pas des
illustrations : ce sont de vrais avatars du jeu, rendus par le moteur du jeu
lui-même (`tools/render-chars.mjs`), puis embarqués en images. Le personnage
que tu choisis à l'inscription est exactement celui avec lequel tu arrives en
ville — et tout reste modifiable ensuite, en jeu.

## « Installer le jeu »

Big Street se joue sur le serveur : il n'y a pas d'exécutable de jeu à poser sur
ton disque. Ce que le bouton **Installer le jeu** télécharge, ce sont ses
**ressources** — environ 1 670 modèles 3D et les données de la ville, ~69 Mo —
que le jeu allait chercher au fil de la partie. Tu choisis le disque et le
dossier ; rien n'est écrit ailleurs.

Un fichier qui refuse de descendre n'arrête pas les autres : il est mis de côté
et repris à la fin, en trois passes. Une installation interrompue reprend là où
elle s'était arrêtée, et le bouton **Vérifier et réparer** retélécharge
uniquement ce qui manque ou a été abîmé.

Ensuite, le launcher sert ces fichiers depuis ton disque au lieu du réseau,
**à condition que leur empreinte corresponde** à celle que le site annonce. Dès
qu'une ressource change côté serveur, c'est la version du serveur qui est
utilisée : une copie locale périmée ne peut pas te faire jouer avec un vieux
contenu. Tu peux supprimer ce dossier à tout moment, le jeu retombera
simplement sur le réseau.

### Changer de disque

Le bouton ⚙ à côté de « Lancer Big Street » liste tes disques avec leur place
libre, les SSD en premier. Pour les reconnaître, le launcher lit seulement la
liste des volumes et le type de chaque disque (SSD ou disque dur) par
PowerShell (`Get-Volume`, `Get-PhysicalDisk`). Rien n'est écrit à ce moment-là.
Si tu choisis un autre disque, les ressources y sont copiées fichier par
fichier et vérifiées. L'ancienne copie n'est effacée qu'après. Si quelque chose
échoue en route, le jeu reste à son ancien emplacement.

## Le jeu n'est pas dans le launcher

Le launcher pèse ~78 Mo mais **ne contient pas le jeu** : c'est le poids
d'Electron, c'est-à-dire du navigateur. Le jeu vit sur le serveur et se met à
jour côté serveur. C'est pour ça que tu n'as jamais de « patch » à télécharger.

## Vérifier ce que tu télécharges

Chaque release donne, dans ses notes sur GitHub :

- l'**empreinte SHA-256** de l'installeur, en clair, et le fichier
  `SHA256SUMS.txt` pour tous les fichiers publiés ;
- une **attestation de provenance** : GitHub certifie que l'installeur a été
  construit par le workflow public de ce dépôt, à partir du commit indiqué,
  sans retouche à la main ;
- le **journal complet de la construction** (onglet Actions) ;
- quand elle est faite, l'**analyse VirusTotal** de l'installeur.

Comparer l'empreinte :

```powershell
# PowerShell, dans le dossier de téléchargement
Get-FileHash .\BigStreet-Setup-1.5.4.exe -Algorithm SHA256
```

Vérifier la provenance (avec l'outil `gh` de GitHub) :

```bash
gh attestation verify BigStreet-Setup-1.5.4.exe --repo StrangeLex/BigStreet
```

La mise à jour automatique vérifie aussi, seule, l'empreinte SHA-512 inscrite
dans `latest.yml` avant d'installer quoi que ce soit.

Et si tu ne fais confiance à rien de tout ça : **compile-le toi-même**.

```bash
git clone https://github.com/StrangeLex/BigStreet.git
cd BigStreet && npm install && npm run dist
```

## Signature et « Éditeur inconnu »

L'installeur est signé gratuitement par **SignPath Foundation**, qui signe les
projets open source après les avoir examinés. Ce que signe le dépôt, et qui
approuve chaque signature, est décrit dans [CODE_SIGNING.md](CODE_SIGNING.md).
Clic droit sur l'installeur > Propriétés > Signatures numériques : tu y lis
« SignPath Foundation ».

Tant qu'une version n'est pas signée, Windows affiche « Éditeur inconnu ». Ce
n'est pas un signe de danger, seulement l'absence de signature.

## Une question, un doute ?

Ouvre une issue : https://github.com/StrangeLex/BigStreet/issues
