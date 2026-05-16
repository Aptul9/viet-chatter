# Domande frequenti

## Il bot mi sostituisce davvero?

Non ti sostituisce. Risponde "come te" su un sottoinsieme di chat, ma:

- Tu puoi sempre rispondere prima e lui si ferma.
- Tu vedi tutti i messaggi normalmente sul telefono.
- Tu controlli a chi risponde via la regola di filtro.

## Le persone si accorgono che è un bot?

Difficile, ma non impossibile. Tre cose lo fanno sembrare umano:

- Tempi di risposta realistici (non 2 secondi).
- Niente notte.
- Memoria del passato e tono adattivo.

Se le risposte sono troppo perfette o troppo generiche, qualcuno potrebbe sospettare. Dipende dal modello AI scelto e dalla qualità del prompt.

## Posso configurare un tono "flirty" o "sarcastico"?

Sì, ma indirettamente. Non c'è un selettore "tono = flirty". L'AI mantiene una nota di tono per persona che evolve dalla conversazione. Se le tue prime conversazioni sono flirty, lui imparerà a mantenere quel registro.

Più controllabile: nella regola di filtro o nel prompt iniziale puoi inserire indicazioni generali ("rispondi sempre in modo casuale e amichevole"). Ma la personalizzazione fine è automatica.

## Posso fargli usare il mio modo di scrivere (errori di battitura, slang)?

In parte. L'AI cerca di adattarsi al registro che vede nei tuoi messaggi precedenti (lui legge tutta la cronologia). Se scrivi in maniera molto particolare (errori sistematici, abbreviazioni tue), col tempo lui imita.

Per imitazione perfetta servirebbe fine-tuning, fuori scope di questa versione.

## Quanti soldi spende?

Dipende dal provider AI scelto.

- Modelli locali (via OpenCode con backend locale): zero costo.
- Modelli cloud (Anthropic, Gemini, Groq tier paid): pochi centesimi a giornata, dipendente dal volume di chat.

Per un volume tipico (10-30 risposte al giorno totali), si parla di costi inferiori a un caffè a settimana. Se vuoi zero costo, vai locale.

## Risponde anche quando il PC è in stand-by?

No. Se il PC dorme, anche il bot dorme. WhatsApp accumula i messaggi, lui li gestisce al risveglio.

## Posso farlo girare su un Raspberry Pi / VPS / cloud?

Tecnicamente sì, ma:

- Servono risorse per il Chromium di whatsapp-web.js (Raspberry Pi 4 8GB ce la fa, sotto è teso).
- Su un VPS cloud diventa un servizio always-on, costo mensile.
- WhatsApp può segnalare l'uso prolungato di sessioni Web da IP datacenter come "uso non personale" e bloccare. Rischio reale.

Setup tipico raccomandato: il tuo PC personale acceso, oppure un mini-PC casalingo.

## E se mi bloccano l'account WhatsApp?

WhatsApp Web non è un'API ufficiale per bot. L'uso massiccio o "non umano" può portare a sospensione dell'account. Mitigazioni che il bot adotta:

- Tempi di risposta umani (non istantanei).
- Niente notte.
- Solo chat 1:1, niente broadcast.
- Niente automazione su gruppi.

Rischio residuo non zero. Usalo con criterio.

## Posso vedere cosa ha risposto?

Sì, semplicemente aprendo le chat su WhatsApp. Le risposte del bot appaiono come messaggi tuoi normali. Per dettagli su quando è partita ogni risposta e perché, ci sono i log nella cartella `logs/`.

## Posso disabilitare temporaneamente il bot per una persona?

Modifichi la regola di filtro per escluderla, salvi. Da quel momento la chat torna sotto controllo manuale completo.

## Cancellando un fatto dal diario, lo dimentica davvero?

Sì. Modifichi/cancelli la riga nel file `.db` (richiede strumento DB tipo DB Browser for SQLite), e il bot non lo userà mai più. È irreversibile a meno di backup.

## Cosa succede se l'AI sbaglia e dice qualcosa di imbarazzante?

Può succedere. Il bot non ha controlli umani su ogni risposta (è "fully autonomous"). Per ridurre il rischio:

- Inizia con poche persone, contatti meno critici.
- Controlla periodicamente le chat per vedere come sta andando.
- Se vedi un messaggio sbagliato, scrivi tu un messaggio di "scusa, non volevo".

Per ridurre la probabilità che inventi informazioni che non sa, è attivata di default la **escalation a umano** (vedi `12-quando-ti-chiama.md`): l'AI ti notifica fuori da WhatsApp quando una richiesta richiede informazioni che non ha (appuntamenti futuri, scelte personali, argomenti delicati). Tu rispondi a mano in quei casi.

## Il bot mi avvisa quando non sa rispondere?

Sì. Quando il messaggio chiede informazioni o decisioni che il bot non può conoscere o sostituire (appuntamenti, prestiti, argomenti delicati), invece di inventare manda una notifica fuori da WhatsApp (Telegram o WhatsApp self-chat). Vedi `12-quando-ti-chiama.md` per il dettaglio.

## Posso configurare via Telegram?

In v1 no. Il setup di Telegram serve solo come canale di notifica per le escalations. In futuro potrebbe essere esteso per ricevere comandi dal bot Telegram (es. snooze), ma in v1 è solo una direzione: bot -> tu.

## Funziona con WhatsApp Business?

Probabilmente sì come account collegabile, ma non è stato testato e WhatsApp Business ha politiche diverse. Usalo a tuo rischio.
