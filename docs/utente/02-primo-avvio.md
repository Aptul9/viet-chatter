# Primo avvio

## Cosa serve

- Un computer (Windows, Linux o Mac) sempre acceso quando vuoi che il bot risponda.
- Connessione internet.
- Il tuo telefono con WhatsApp installato e funzionante (per la prima sincronizzazione).
- (Opzionale ma consigliato) Un bot Telegram personale per ricevere le notifiche di "escalation a umano". Vedi `12-quando-ti-chiama.md` per cos'è e perchè serve, e `dev/15-runbook.md` per il setup tecnico (5 minuti).

## Procedura

1. Apri il terminale nella cartella del progetto.
2. Lanci il comando di avvio (`npm start`).
3. Compare un QR code nel terminale.
4. Apri WhatsApp sul telefono, vai in `Impostazioni > Dispositivi collegati > Collega un dispositivo`.
5. Inquadra il QR code.
6. Il bot si collega alla tua sessione WhatsApp Web e inizia a osservare i messaggi.

## Dopo il primo avvio

La sessione viene salvata localmente. Le volte successive non serve più scansionare il QR (a meno che tu non stacchi il dispositivo da WhatsApp manualmente, o passino mesi di inattività).

Se tieni il computer acceso, il bot continua a girare. Se lo spegni, il bot si ferma. Quando lo riaccendi e rilanci, il bot:

- Recupera i messaggi arrivati mentre era spento.
- Decide se erano nelle chat da gestire.
- Pianifica le risposte come se fosse stato online dall'inizio (rispetta i delay, non spara tutto in faccia).

## Cosa vedi mentre gira

Il terminale resta aperto e mostra log di base: chi ha scritto, cosa il bot sta facendo, eventuali errori. Niente di drammatico: serve solo a sapere se è vivo.

I log dettagliati vengono salvati nella cartella `logs/` per poter capire eventualmente cosa è successo.

## Quando il computer si spegne

Se il PC si spegne (chiusura, riavvio, crash), il bot smette di rispondere. Le persone scrivono lo stesso, i loro messaggi restano in WhatsApp. Quando riaccendi e rilanci il bot, lui li trova e li gestisce.

Non c'è perdita di messaggi, solo ritardo finché non torna online.

## Quando WhatsApp ti chiede di riconnettere

Può capitare che WhatsApp scolleghi i dispositivi (succede se non usi WhatsApp Web da molto tempo, o per motivi di sicurezza). In quel caso al riavvio del bot ricomparirà il QR code: lo riscansioni e tutto riprende.
