# Transparence

Tu installes un exécutable. Tu as le droit de savoir exactement ce qu'il fait.
Ce document est la référence ; le code de cette page est dans `src/main.js`,
tout tient en 120 lignes et il est public.

## Ce que le launcher fait

- Ouvre `https://playbigstreet.com/` dans une fenêtre Chromium (Electron).
- Affiche un écran de chargement pendant la connexion.
- Renvoie les liens externes vers ton navigateur habituel.
- Vérifie au démarrage, puis toutes les 6 heures, s'il existe une version plus
  récente **du launcher** sur les releases GitHub de ce dépôt.
- Si oui : télécharge la mise à jour et **te demande** avant de redémarrer.
- Écrit un journal local, sur ta machine uniquement
  (`%APPDATA%\Big Street\logs\main.log`).

## Ce que le launcher ne fait pas

- **Aucune télémétrie**, aucune statistique d'usage, aucun traçage.
- **Aucune collecte** de données personnelles. Il n'envoie rien nulle part,
  à part les requêtes vers le site du jeu et la vérification de version GitHub.
- **Aucun identifiant embarqué** : il ne contient ni clé, ni jeton, ni secret.
  Les mises à jour sont publiques et anonymes, vérifie-le toi-même.
- **Aucun accès à tes fichiers**, hors son propre dossier d'installation et de
  journal. Le rendu web tourne en bac à sable (`sandbox: true`,
  `nodeIntegration: false`, `contextIsolation: true`).
- Il **ne se met pas à jour en silence** : rien ne s'installe sans ton accord.

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
