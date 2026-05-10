# Workflow e casi d'uso

Esempi concreti di cosa succede in scenari reali.

## Caso 1: prima persona aggiunta alla regola

**Situazione**: hai appena configurato il bot. La regola dice "rispondi a numeri vietnamiti". Hoa (numero +84...) ti scrive per la prima volta.

**Cronologia**:

- 14:00 Hoa scrive "Hi! How are you?".
- 14:00 il bot vede, controlla la regola: numero +84, passa.
- 14:00 il bot inizia il timer di silenzio (2 minuti). Lei sta scrivendo? Aspetta.
- 14:02 due minuti di silenzio, raffica chiusa.
- 14:02 calcolo del delay: con Hoa non hai cronologia di risposte, default 30 minuti.
- 14:02 con casualita +/-20%: per esempio 27 minuti. Risposta programmata per le 14:29.
- 14:29 il bot manda: "Hey Hoa, all good. You?".
- 14:29 l'AI nota che Hoa scrive in inglese, salva nel profilo `languages: [en]`.

**Diario aggiornato**: niente di importante o secondario ancora estratto (la conversazione è troppo iniziale).

## Caso 2: raffica di 4 messaggi

**Situazione**: Lan (in lista) ti manda 4 messaggi in fila.

**Cronologia**:

- 09:30 Lan: "Ciao".
- 09:30 timer parte (2 min).
- 09:30:15 Lan: "Come stai?" -> timer reset.
- 09:30:35 Lan: "Ho una cosa da dirti..." -> timer reset.
- 09:31:10 Lan: "Hai 5 minuti?" -> timer reset.
- 09:33:10 due minuti di silenzio totale, raffica chiusa.
- 09:33:10 calcolo delay: ultime 5 risposte a Lan in media 45 minuti, +/-20% -> per esempio 41 min.
- 09:33:10 risposta programmata per le 10:14.
- 10:14 il bot manda UNA risposta che indirizza tutti e 4 i messaggi: "Ciao Lan, sto bene, dimmi pure".

## Caso 3: tu rispondi prima del bot

**Situazione**: come Caso 2, ma alle 10:00 (prima delle 10:14 programmate) tu rispondi a mano.

**Cronologia**:

- 10:00 tu scrivi: "tutto ok, dimmi" da telefono.
- 10:00 il bot vede l'evento `out_manual`, annulla il job programmato per le 10:14.
- 10:00 chat torna in stato `IDLE`.
- 10:14 niente parte (job era stato cancellato).

**Latency**: 30 minuti dal terzo messaggio di Lan. Questa entra nella media rolling per i prossimi calcoli.

## Caso 4: bot offline e poi torna

**Situazione**: spegni il PC alle 18:00. Lan ti scrive alle 19:00, alle 20:30, alle 21:45. Riaccendi il PC alle 22:30 (ma siamo in night window, 22-06).

**Cronologia**:

- 22:30 lanci il bot, parte il boot.
- 22:30 reconciliation: il bot vede che Lan ha 3 messaggi nuovi rispetto all'ultimo che aveva visto (15:00). Li carica.
- 22:30 normalmente farebbe partire l'accumulazione e il calcolo delay. Ma calcolando il delay, il fire cadrebbe in night window -> shift al mattino.
- 22:30 risposta programmata per le 06:05 circa (06:00 + jitter casuale).
- 06:05 risposta parte.

## Caso 5: compleanno

**Situazione**: durante una conversazione 3 settimane fa, Hoa ha detto "il mio compleanno è il 22 febbraio". L'AI ha estratto e salvato come fatto importante, con data ricorrente.

**Cronologia**:

- 22 febbraio, 09:00 (orario "buona ora del mattino" + jitter): scatta il job auguri.
- 09:00 il bot controlla: nelle ultime 12 ore avete scambiato messaggi? No.
- 09:00 il bot manda automaticamente: "Hey Hoa, tanti auguri!".

**Variante**: voi avete chattato alle 23:50 della sera prima. Alle 09:00 il bot vede gli scambi recenti, NON manda gli auguri come messaggio separato. Aspetta che Hoa risponda al messaggio precedente: quando lei risponde, l'AI durante la generazione vede "oggi è il compleanno" nel diario e include l'augurio nella risposta normale.

## Caso 6: cuore secco dopo conversazione lunga

**Situazione**: con Lan avete chattato per 2 ore di seguito (15 messaggi a testa). Il tuo ultimo messaggio era una battuta. Lei risponde solo con un cuore.

**Cronologia**:

- 17:00 il tuo ultimo messaggio (via bot).
- 17:02 Lan: "❤️" -> arriva al bot come messaggio.
- 17:04 raffica chiusa (silenzio 2 min).
- 17:04 il bot calcola la risposta. L'AI valuta:
  - Conversazione molto attiva oggi: si.
  - Lei ha mandato solo un cuore: chiusura ambigua.
  - Suggerisce `revive_hint = { attempt_in_minutes: 50 }`.
- 17:04 il bot decide: skip risposta immediata (l'AI ha detto skip per l'❤️ singolo). Ma crea un job revive per le 17:54.
- 17:54 scatta il revive. AI genera follow-up leggero: "Per la cronaca, era una battuta ;)". Manda.
- 18:30 Lan non ha risposto. Il job è già stato fatto, non si ripete.

## Caso 7: re-engage dopo 2 settimane

**Situazione**: con Mai non parli da 14 giorni. La regola di filtro la include.

**Cronologia**:

- giorno 14, ore 09:00: cron giornaliero scansiona le chat.
- 09:00 trova Mai: ultimo scambio 14 giorni fa, soglia 14 giorni superata, nessun job pendente, non in stato `cold`.
- 09:00 crea un job re-engage per le 10:30 (orario sensato + jitter).
- 10:30 scatta. AI legge diario di Mai: "lavora a Hanoi", "ultima volta era stressata".
- 10:30 AI genera: "Hey Mai, come va? Tutto ok col lavoro?". Manda.
- giorno 21 (7 giorni dopo): Mai non ha risposto. Mai marcata come `cold`. Niente più re-engage finche lei non scrive prima.

## Caso 8: tu invii a freddo (proattivo)

**Situazione**: tu apri WhatsApp e scrivi a Hoa di tua iniziativa "Hey, hai un consiglio per un ristorante?".

**Cronologia**:

- 12:00 il tuo `out_manual`. Il bot lo vede, lo registra in `processed_messages`. State resta `IDLE` (nessun in pendente).
- 12:30 Hoa risponde: "Sushi place near Old Quarter".
- 12:30 il bot vede l'incoming, applica filtro, accumulo e delay.
- ~13:15 il bot risponde basandosi sul tuo messaggio + il suo. Gestisce normalmente.

Niente di speciale: i tuoi messaggi proattivi entrano nello storico, tutto il resto come al solito.

## Caso 9: cambio di tono nel tempo

**Situazione**: con Phuong il tono iniziale era "casual scherzoso". Da una settimana lei sta passando un brutto periodo (lavoro, famiglia).

**Cronologia evolutiva**:

- giorno 1-7: nota tono "casual, ironico, battute".
- giorno 8: lei dice "sono molto stressata". L'AI estrae fatto effimero, e nel `tone_update` propone "supportivo, attento, meno battute".
- giorno 8 in poi: il bot genera risposte più caring. Il diario contiene il fatto effimero "stressata dal lavoro" che scade tra 7 giorni.
- giorno 15: il fatto effimero scade. La nota di tono resta finche l'AI non rileva un cambio nei suoi messaggi (lei torna allegra).
- giorno 20: lei dice "tutto risolto, finalmente respiro!". L'AI aggiorna `tone_update = "casual, scherzoso"`.

## Caso 10: regola di filtro modificata in corsa

**Situazione**: il bot gira da 3 giorni. Vuoi escludere il numero di Linh.

**Cronologia**:

- 16:00 apri `config/index.ts`, aggiungi `+84LinhNumber` alla blacklist, salvi.
- 16:00 il bot rileva il file modificato, ricarica la regola, valida con zod, swap atomico.
- 16:01 Linh ti scrive. Il bot legge, controlla la NUOVA regola: numero in blacklist -> non passa. Ignora.

Niente downtime, niente restart.
