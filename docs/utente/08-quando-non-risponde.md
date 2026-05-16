# Quando NON risponde

Lista delle situazioni in cui il bot, di proposito, non manda nulla.

## Casi normali

### Tu hai risposto prima

Se tu rispondi manualmente a un messaggio (da telefono o da WhatsApp Web di un altro PC) prima che il bot abbia inviato la sua risposta, il bot annulla. Vince sempre l'azione umana.

### Persona non in lista

Se il numero non passa la regola di filtro che hai configurato, il bot ignora completamente la chat. Vedi il messaggio sul telefono come al solito, e lo gestisci tu.

### Chat di gruppo

Sempre ignorate, indipendentemente dalla regola.

### Notte (22:00 - 06:00)

In questo intervallo il bot non manda nulla. I messaggi ricevuti vengono accumulati e gestiti dalla mattina.

### Messaggio non testuale

Se la persona manda solo uno sticker, una foto, un audio, un video, un file: il bot vede arrivare un placeholder ("[sticker]" o simile). L'AI può comunque decidere di rispondere brevemente (es. a un cuore con un cuore), oppure di stare zitto. La decisione è dell'AI in base al contesto.

### L'AI decide "skip"

In ogni turno, l'AI può decidere che non c'è motivo di rispondere. Esempi:

- Lei ha mandato solo un emoji di chiusura conversazione.
- Il messaggio non richiede risposta (es. "ok grazie").
- Il contenuto è ambiguo e una risposta forzata sembrerebbe strana.

In questi casi non parte nulla. Il bot resta in attesa del prossimo messaggio.

### L'AI decide "escalation a umano"

Il bot capisce che il messaggio richiede informazioni o decisioni che non può sapere/sostituire (appuntamenti futuri, favori, argomenti delicati). In questo caso non manda una risposta automatica e ti notifica su Telegram (o WhatsApp self-chat).

Esempi tipici: "ci vediamo sabato?", "mi presti X?", argomenti emotivamente delicati.

Il bot può inviare un breve "ti faccio sapere" alla persona per non lasciarla in silenzio, ma poi sta a te rispondere a mano.

Vedi `12-quando-ti-chiama.md` per il dettaglio.

### Errore tecnico

Se l'AI fallisce nel generare una risposta valida (errore di rete, output non parsabile, retry esauriti), il bot non manda niente piuttosto che mandare qualcosa di sbagliato. L'errore va nei log per analisi.

### Bot offline

Se il computer è spento, il bot non gira e non risponde. Quando torna online, recupera i messaggi e gestisce con i delay normali.

## Casi limite

### Race "tu rispondi nel millisecondo esatto"

Se invii un messaggio nell'esatto istante in cui il bot stava per inviare il suo, possono partire entrambi. Probabilità bassissima ma non zero. Se succede, vedi due messaggi (il tuo e quello del bot).

### Messaggi accumulati durante l'invio

Se durante i 3-10 secondi in cui il bot sta generando la risposta, la persona manda altri messaggi: la risposta corrente esce comunque (basata sui messaggi presenti al momento di iniziare). I nuovi messaggi appena arrivati saranno gestiti nel prossimo turno (parte un nuovo accumulo).

### Re-engage / revive / auguri pendenti

Se il bot aveva pianificato un messaggio automatico (auguri, revive, re-engage) e nel frattempo arriva un messaggio dalla persona o tu rispondi: il job pendente si cancella. Niente messaggio doppio.

## Cosa fare se vedi il bot rispondere quando NON volevi

Aggiungi quella persona alla blacklist nelle regole filtro: o via web UI (`npm run dev` → `http://localhost:3000`, tab Filter, campo "Blocked numbers"), oppure a mano editando `config/user-config.yaml` (blocco `filter.blockedNumbers`). Da quel momento il bot la ignora (hot-reload automatico).
