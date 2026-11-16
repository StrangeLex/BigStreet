# Politique de signature / Code signing policy

*Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).*

## Ce qui est signé / What is signed

Uniquement l'installeur Windows du launcher (`BigStreet-Setup-<version>.exe`),
construit par GitHub Actions à partir de ce dépôt public
(`.github/workflows/release.yml`), à la pose d'un tag `v*`. Aucun fichier
construit ailleurs, ni aucun fichier tiers, n'est signé.

Only the Windows installer of the launcher, built by GitHub Actions from this
public repository when a `v*` tag is pushed. Nothing built elsewhere, and no
third-party binary, is ever signed.

## Rôles / Team roles

| Rôle / Role | Personne / Person |
|---|---|
| Auteur et relecteur / Committer and reviewer | [StrangeLex](https://github.com/StrangeLex) |
| Approbateur de signature / Signing approver | [StrangeLex](https://github.com/StrangeLex) |

Chaque demande de signature est approuvée à la main. Each signing request is
manually approved.

## Confidentialité / Privacy policy

Le launcher ne transmet aucune information à d'autres systèmes que ceux-ci, et
seulement pour ce que le joueur demande :

- `playbigstreet.com` — le jeu lui-même : connexion, compte, amis, ressources du jeu ;
- `api.github.com` / `github.com` — vérification et téléchargement des mises à jour du launcher.

Aucune télémétrie, aucune statistique d'usage. Le détail est dans
[TRANSPARENCE.md](TRANSPARENCE.md).

This program will not transfer any information to other networked systems
unless specifically requested by the user or the person installing or operating
it. It only talks to `playbigstreet.com` (the game it launches) and GitHub
(launcher updates). No telemetry.
