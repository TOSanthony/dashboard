# wh_bridge.elf -- structure en plusieurs fichiers

Version découpée de `installer.c` (796 lignes en un seul fichier) pour faciliter
la lecture. **Comportement strictement identique** au build monolithique :
- le blob `bridge_hbc` embarqué est octet pour octet identique
- le JS du loader (`loader.js`) est octet pour octet identique au
  `WH_LOADER_HEAD` original (y compris les deux patches ci-dessous)
- toute la logique C (découverte du point de hook, écriture mémoire, cave,
  serveur HTTP, construction du prélude) a été copiée verbatim, juste répartie
  entre plusieurs fichiers.

Vérifié après compilation : taille et SHA-256 du blob `bridge_hbc` extrait du
binaire final identiques à `bridge.hbc` ; JS du loader extrait identique à
`loader.js`.

## Base

`geodox/ps5-wh-widgets` tag `26.11.13beta` -- la version qui embarque le bridge
HBC complet directement (au lieu de le reconstruire à partir d'un "delta" au
runtime, ce qui échouait silencieusement sur certains firmwares, dont le
tien). C'est ce qui a corrigé le bug "aucun widget ne s'enregistre".

## Les deux patches (dans `loader.js`)

1. **`hideKeyGuide`** -- un widget peut mettre `"hideKeyGuide": true` dans son
   `config.json` pour masquer la barre d'aide des touches (key-guide) en bas
   de l'écran.
2. **Patch de reconnexion PSN intégré** -- reprend la logique de l'ancien
   widget séparé `hub-signin-patch` (fait croire au hub que le compte PSN est
   connecté), maintenant appliquée automatiquement par le payload lui-même.
   Le dossier `hub-signin-patch` dans `/data/wh-widgets` n'est plus
   nécessaire et peut être supprimé.

## Visibilité des tuiles (app.db)

Au démarrage, le payload écrit directement dans `/system_data/priv/mms/app.db`
(table `tbl_iconinfo*`, même mécanisme que `TOSanthony/ps5-unhide-debug-settings`
-- `appdb.h` / `dashboard.c`) pour fixer :

| Tuile | ID | Visibilité |
|---|---|---|
| Welcome Hub | `NPXS40063` | affichée |
| PlayStation Store | `NPXS40047` | masquée |
| PlayStation Plus | `NPXS40037` | masquée |

Aucun redémarrage de ShellUI ni de la console n'est nécessaire : le shell
relit `app.db` de lui-même. Une sauvegarde (`/data/app.db.<horodatage>.bak`)
est faite une seule fois par lancement du payload, avant toute modification.
L'opération est idempotente : une tuile déjà au bon état n'est pas touchée.

C'est dans `tiles.c` (logique reprise et réduite de `appdb.h`, adaptée pour
réutiliser les logs du payload plutôt que de redéclarer sa propre fonction de
notification). Pour changer la politique par défaut, modifie le tableau
`TILES` en haut de `tiles.c`.

## Synchronisation de l'heure (NTP)

Au démarrage, le payload tente aussi de remettre à l'heure l'horloge système
via NTP -- utile si la pile CMOS/RTC est morte ou débranchée et que la
console redémarre avec une date figée. Porté en C depuis
`kerrdec97/ps5-date-time-sync` (`timesync.c`), même liste de serveurs et
mêmes vérifications :

- adresses numériques Cloudflare en premier (`162.159.200.1`/`.123`, pas de
  dépendance au DNS), puis `time.cloudflare.com`, `pool.ntp.org`,
  `time.google.com` en repli ;
- réponse validée (version/mode NTP, strate, horodatage de la requête, plage
  de dates 2000-2100) avant tout changement d'horloge ;
- correction de la moitié du round-trip, écriture via `settimeofday`, puis
  relecture de l'horloge pour vérifier que le changement a bien pris ;
- le fuseau horaire réglé sur la console n'est pas touché.

Non bloquant : si le réseau ou les serveurs NTP sont injoignables, le reste
du payload (widgets, tuiles) s'installe quand même normalement. Le résultat
est ajouté à la notification de démarrage ("Clock: synced via NTP") et
toujours journalisé dans `wh.log`.

## Fichiers

| Fichier | Contenu |
|---|---|
| `common.h` | includes système partagés, `WH_VERSION`, `WH_WIDGETS_DIR` |
| `util.h` / `util.c` | logs (`wh_flog`/`LOG`), notifications, `find_pid`, helpers JSON/fichiers |
| `remote.h` / `remote.c` | ptrace élevé, lecture/écriture mémoire distante, mmap distant |
| `cave.h` | layout (offsets) du "code cave" écrit dans SceShellUI |
| `hookpoint.h` / `hookpoint.c` | découverte par signature d'`evaluateJavaScript` et de son slot de vtable |
| `prelude.h` / `prelude.c` | construit le JS injecté : `loader.js` + un bloc par widget trouvé dans `/data/wh-widgets` |
| `server.h` / `server.c` | petit serveur HTTP (images des widgets, `/__log`, `/__wget`, `/__wset`) |
| `install.h` / `install.c` | une installation complète : attach, construit la cave, l'écrit, repointe le hook |
| `main.c` | point d'entrée : trouve ShellUI, installe, reste en vie comme serveur d'assets |
| `embed.S` | embarque `bridge.hbc` (symboles `bridge_hbc_start`/`end`) et `loader.js` (symbole `wh_loader`) |
| `loader.js` | le JS du loader (généré depuis `WH_LOADER_HEAD`, patches inclus) |
| `bridge.hbc` | bytecode Hermes complet extrait de la release officielle 26.11.13beta |
| `wh_detour.h`, `wh_sigs.h` | fournis tels quels par geodox (détour assembleur, signatures de scan) |
| `tiles.h` / `tiles.c` | écrit la visibilité des tuiles dans `app.db` au démarrage |
| `sqlite3.c`, `sqlite3.h` | amalgame SQLite (domaine public, sqlite.org), nécessaire pour lire/écrire `app.db` -- repris de `tosanthony/psgfx` |
| `timesync.h` / `timesync.c` | synchronise l'horloge via NTP au démarrage (porté de `kerrdec97/ps5-date-time-sync`) |

## Build

```sh
export PS5_PAYLOAD_SDK=/chemin/vers/ps5-payload-sdk
./build.sh
```

Produit `wh_bridge.elf`, à copier à l'endroit habituel pour l'installation.
