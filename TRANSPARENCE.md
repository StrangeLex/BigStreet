# Transparence

Tu installes un exécutable. Tu as le droit de savoir exactement ce qu'il fait.
Ce document est la référence ; le code de cette page est dans `src/main.js`,
tout tient en 120 lignes et il est public.

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
- **Aucun identifiant embarqué** : il ne contient ni clé, ni jeton, ni secret.
  Les mises à jour sont publiques et anonymes, vérifie-le toi-même.
- **Aucun accès à tes fichiers**, hors son propre dossier d'installation et de
  journal. Le rendu web tourne en bac à sable (`sandbox: true`,
  `nodeIntegration: false`, `contextIsolation: true`).
- Il **ne touche à rien d'autre** que son propre dossier. Seule l'application
  elle-meme est mise a jour, jamais le reste de ta machine.

## Les personnages affichés

Les personnages de l'écran d'accueil et du choix de départ ne sont pas des
illustrations : ce sont de vrais avatars du jeu, rendus par le moteur du jeu
lui-même (`tools/render-chars.mjs`), puis embarqués en images. Le personnage
que tu choisis à l'inscription est exactement celui avec lequel tu arrives en
ville — et tout reste modifiable ensuite, en jeu.

## Le jeu n'est pas dans le launcher

Le launcher pèse ~78 Mo mais **ne contient pas le jeu** : c'est le poids
d'Electron, c'est-à-dire du navigateur. Le jeu vit sur le serveur et se met à
jour côté serveur. C'est pour ça que tu n'as jamais de « patch » à télécharger.

## Vérifier ce que tu télécharges

Chaque release publie un fichier `latest.yml` qui contient l'empreinte SHA-512
de l'installeur. L'updater la vérifie automatiquement, et tu peux la vérifier
à la main :

```powershell
# PowerShell, dans le dossier de téléchargement
Get-FileHash .\BigStreet-Setup-1.0.1.exe -Algorithm SHA512
```

Compare le résultat avec le champ `sha512` du `latest.yml` de la release
(il est encodé en base64, pas en hexadécimal — passe-le par un convertisseur
ou fie-toi à la vérification automatique de l'updater).

Et si tu ne fais confiance à rien de tout ça : **compile-le toi-même**.

```bash
git clone https://github.com/StrangeLex/BigStreet.git
cd BigStreet && npm install && npm run dist
```

## « Éditeur inconnu » au lancement

Windows affiche cet avertissement parce que l'installeur n'est pas signé par un
certificat payant. Ce n'est pas un signe de danger, seulement l'absence d'un
certificat à plusieurs centaines d'euros par an. Si cela te gêne, la solution
ci-dessus reste valable : compile depuis les sources.

## Une question, un doute ?

Ouvre une issue : https://github.com/StrangeLex/BigStreet/issues
