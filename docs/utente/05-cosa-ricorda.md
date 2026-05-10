# Cosa ricorda

Il bot tiene un piccolo "diario" per ogni persona con cui parla. Non salva i messaggi, salva i fatti che servono per rispondere meglio la prossima volta.

## I tre livelli di memoria

### Importanti

Cose grosse, che restano. Eventi che cambiano come ti rapporti a quella persona:

- "Suo padre sta male di cancro."
- "Si è separata da Marco a marzo."
- "Le è morto il cane."
- "Ha avuto una promozione importante."
- "Compleanno: 22 febbraio."

Questi fatti restano sempre. Non scadono. Vengono usati ogni volta per dare contesto alla risposta.

### Secondari

Dettagli interessanti ma non critici:

- "Lavora come grafica a Hanoi."
- "Ha un cane di nome Pluto."
- "Le piace il sushi."
- "Tifa Inter."

Crescono nel tempo, possono essere tanti. Il bot pesca quelli pertinenti al momento, non li usa tutti insieme.

### Effimeri

Cose temporanee, di passaggio. Scadono dopo 7 giorni.

- "Giovedì va a fare le unghie."
- "Stasera cena con la sorella."
- "Questa settimana è stressata dal lavoro."
- "Domani parte per Da Nang."

Dopo una settimana spariscono in automatico. Logica: dopo 7 giorni quel piano è già passato, non serve più ricordarlo.

## Come si riempie il diario

Automaticamente. Dopo ogni risposta che il bot manda, l'AI legge la conversazione e decide se ci sono fatti nuovi da ricordare. Li mette nel livello giusto da sola.

Non serve scrivere nulla a mano.

## Posso vedere il diario?

I dati stanno in un singolo file sul computer (un database). Non c'è ancora un'interfaccia per consultarlo comodamente. In futuro è prevista una piccola pagina web di sola lettura per vederli.

## Posso correggere o cancellare un fatto?

Non c'è uno strumento dedicato. La via prevista è scriverlo nella conversazione stessa (es. "in realtà mio padre sta benissimo, ti ho detto un'altra cosa") e l'AI dovrebbe correggere il fatto vecchio sostituendolo con quello nuovo.

In casi limite (errore grave, fatto delicato che il bot non deve usare), si interviene a mano sul database. Non è la via normale.

## Vengono usati ogni volta?

- Importanti e effimeri: sempre, ogni risposta.
- Secondari: solo quelli pertinenti al messaggio in arrivo. Esempio: se lei ti scrive di cibo, il bot tira fuori "le piace il sushi" e ignora "tifa Inter".

## Privacy

Tutto resta sul tuo computer. Niente cloud, niente backup automatico, nessun servizio esterno conosce questi fatti. Vedi `09-privacy-dati.md`.
