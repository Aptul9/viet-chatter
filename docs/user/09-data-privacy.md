# Privacy e dati

## Dove vivono i dati

Tutto sul tuo computer. Niente cloud, niente servizi terzi, niente backup automatico.

Concretamente:

- **Messaggi WhatsApp**: restano dove sono già, in WhatsApp. Il bot non li copia in un suo database.
- **Diario delle persone (importanti, secondari, effimeri)**: in un singolo file `viet-chatter.db` nella cartella del progetto.
- **Stato dei job e dello scheduler**: stesso file `.db`.
- **Log di funzionamento**: nella sottocartella `logs/`.
- **Sessione WhatsApp Web**: nella sottocartella `.wwebjs_auth/`.

## Cosa NON viene salvato

- Il testo completo dei messaggi non viene mai duplicato in un nostro database. Il bot lo legge live da WhatsApp quando serve, e basta.
- Niente trascrizioni di audio, niente OCR di immagini.
- Niente analisi statistica esterna.

## Cosa va all'AI

Quando il bot deve generare una risposta, manda all'AI (gestita tramite il modulo OpenCode):

- Gli ultimi 30 messaggi della chat (testo).
- Il diario di quella persona (i 3 livelli).
- Profilo persona (lingua, nota di tono).
- Il contesto temporale (giorno, ora).

Questo viene mandato al provider AI che hai configurato dietro OpenCode (Claude, Gemini, ecc.). I provider AI vedono questo contenuto.

**Conseguenza**: i dati personali delle persone con cui chatti passano dal provider AI scelto. Sceglilo con coscienza. Se vuoi privacy massima, configura un modello locale dietro OpenCode (Llama, Qwen self-hosted, ecc.).

## Cosa NON va all'AI

- Numeri di telefono: vengono mandati come identificativo opaco, non come metadata "questo è il numero della Maria".
- Body di messaggi non testuali (sticker, foto, audio): mandati come placeholder generico ("[sticker]").

## Cifratura dei dati locali

Il file `.db` è in chiaro. Se vuoi cifratura at-rest, accendi BitLocker (Windows) o FileVault (macOS) o LUKS (Linux) sul tuo disco. Il bot non aggiunge un layer di cifratura applicativo.

## Backup

Il bot non fa backup automatici. Se il file `.db` si corrompe o viene cancellato, perdi il diario delle persone e lo stato dello scheduler. La sessione WhatsApp continua a funzionare, ma il bot ricomincia "da zero" sui contesti.

Se vuoi backup, copia tu il file `.db` in un posto sicuro periodicamente. Manualmente.

## Sync multi-macchina

Non supportato. Il bot gira su una sola macchina alla volta. Se sposti la cartella su un altro PC, anche il diario va con lei (basta copiare).

Non collegare il file `.db` a OneDrive, Dropbox, Syncthing, git: rischio di corruzione (sono accessi concorrenti su un DB attivo).

## Cancellazione totale

Per cancellare tutto:

1. Spegni il bot.
2. Cancella la cartella `viet-chatter/` interamente, oppure i singoli file `viet-chatter.db`, `logs/`, `.wwebjs_auth/`.
3. Sul telefono, vai in `WhatsApp > Impostazioni > Dispositivi collegati` e rimuovi la sessione del bot.

Tutto sparisce. Niente residui da pulire altrove.
