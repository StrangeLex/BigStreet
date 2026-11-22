# Big Street — Launcher

Application de bureau officielle de **Big Street**.

Le launcher **n'embarque pas le jeu** : il ouvre `playbigstreet.com` dans une
fenêtre native. Le contenu du jeu se met donc à jour côté serveur, sans que le
joueur ait quoi que ce soit à réinstaller.

Seule l'application elle-même se met à jour, automatiquement, via les
[releases GitHub](https://github.com/StrangeLex/BigStreet/releases).

## Ce qu'il apporte par rapport au navigateur

- fenêtre dédiée, sans barre d'adresse ni onglets
- écran de chargement aux couleurs du jeu
- icône et raccourcis (bureau, menu Démarrer)
- le jeu continue de tourner quand la fenêtre n'est pas au premier plan
- écran clair quand le serveur est injoignable
- mise à jour automatique, différentielle
- carte graphique dédiée (NVIDIA/AMD) demandée sur les PC à deux circuits
- ressources du jeu et suppression de bruit du micro (RNNoise) installables sur le disque
- **Studio** : enregistrer ce qui se passe autour de soi en jeu (fichiers `.bsrec`, en local), puis le revoir en 3D
  dans une application à part — caméra libre, caméras posées, travellings, export vidéo (`src/studio`, `src/records.js`)
- **Console développeur (F10)** : fenêtre à part façon console de Source Engine — journal en direct filtrable et copiable,
  infos en direct (images/s, ping, salle, position…), commandes avec historique et complétion (`src/console-main.js`, `src/console`)

## Développement

```bash
npm install
npm start                       # lance le launcher sur le site de production
BIGSTREET_URL=http://localhost:2021/ npm start   # pointe sur un serveur local
```

## Publier une version

1. Monter `version` dans `package.json` (ex. `1.0.1`)
2. Commiter, puis poser un tag :

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions construit l'installeur sur Windows et publie la release.
Les launchers déjà installés détectent la nouvelle version au démarrage.

## Mises à jour : comment ça marche

`electron-updater` lit `latest.yml` à la racine de la dernière release, compare
la version, télécharge le delta puis propose le redémarrage. Le dépôt étant
public, **aucun jeton n'est nécessaire** et aucun secret n'est embarqué dans
l'application distribuée.

## Contrôles avant publication

```bash
npm run selftest
```

Vérifie l'interface (identifiants, CSP), les garde-fous de chemin, une
installation complète des ressources, sa reprise, la réparation d'un fichier
abîmé, et le refus d'un lien `bigstreet://` forgé. Les réglages en place sont
restaurés à la fin.

## Signature

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).
Politique de signature : [CODE_SIGNING.md](CODE_SIGNING.md).
