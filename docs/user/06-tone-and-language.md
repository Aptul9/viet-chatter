# Tono e lingua

Il bot adatta come parla a chi ha davanti.

## Tono

Per ogni persona, il bot mantiene una "nota di tono" che descrive come si pone con lei.

Esempi:

- "Casuale, ironico, battute frequenti."
- "Affettuoso e attento, lei sta vivendo un momento difficile per il padre."
- "Diretto, conversazione di lavoro, niente fronzoli."
- "Flirt leggero, chiacchiere serali."

Questa nota viene aggiornata da sola dall'AI mano a mano che la conversazione va avanti. Se cambia qualcosa di importante (lutti, momenti difficili, fasi di entusiasmo), il tono si adatta.

Non bisogna scriverla a mano. Non c'è un menu di "personalita predefinite": il tono nasce dalla conversazione stessa.

## Lingua

Per ogni persona, il bot tiene una lista di lingue ammesse. Esempi:

- `[en]`: solo inglese.
- `[vi]`: solo vietnamita.
- `[en, vi]`: usa quella che gli sembra più giusta in base agli ultimi messaggi della persona.

L'AI sceglie ogni volta la lingua "giusta" per quel turno specifico. Se la persona ti scrive in vietnamita, lui risponde in vietnamita. Se passa all'inglese, lui passa all'inglese. Tutto naturale.

### Caso "illusione di traduzione"

Per persone con poco inglese si configura `[vi]`. Il bot risponde sempre in vietnamita. Lei pensa che tu parli vietnamita o che usi un traduttore. La conversazione fila liscia.

### Cambio lingua suggerito dall'AI

Se l'AI nota che una persona inizia a usare consistentemente una lingua diversa da quella configurata (es. configurata `[en]` ma lei scrive solo in vietnamita da 5 messaggi), aggiorna da sola la lista lingue includendo l'altra. Tu non devi fare nulla.

## Sentiment (umore del messaggio in arrivo)

Il bot tiene conto dell'umore del messaggio per scegliere il tono della risposta. Senza farne un caso scientifico: legge la conversazione, capisce se la persona è arrabbiata, triste, contenta, scherzosa, e risponde di conseguenza.

Non ci sono etichette esplicite memorizzate per ogni messaggio (questo è previsto come funzionalita futura). Il sentiment è "sentito" al volo dall'AI ad ogni risposta.

## Memoria di tono nel tempo

Quando inizi a parlare con una persona nuova, il tono parte neutro. Dopo qualche scambio, il bot ha già una nota di tono iniziale. Dopo settimane, la nota è precisa e personalizzata.

Se la conversazione cambia drasticamente direzione (litigio, riconciliazione, momento drammatico), la nota di tono si adatta.
