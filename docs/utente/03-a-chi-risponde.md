# A chi risponde

## L'idea base

Tu definisci delle "regole" che decidono, per ogni chat, se il bot deve gestirla o ignorarla. Le regole sono dichiarative: liste di prefissi numerici ammessi, numeri bloccati, flag "solo contatti salvati", flag "solo chat con messaggi non letti". Si editano via web UI (`http://localhost:3000`, tab Filter) oppure a mano nel file `config/user-config.yaml` (blocco `filter`).

## Esempio tipico

Esempio realistico: vuoi che il bot risponda solo a chi ha numero vietnamita, escludendo due numeri specifici (la zia, il commercialista) e ignorando i contatti salvati in rubrica.

Espresso a parole:

> Risponde se il numero inizia con +84 E non è uno dei due numeri della blacklist.

## Tipi di regole possibili

Le regole sono 4 (combinabili: passa solo se TUTTI i check applicabili passano):

- **Prefissi ammessi** (`allowedPrefixes`): lista di prefissi E.164 (es. `+84`, `+39`). Vuota = nessun filtro per prefisso. Logica OR tra prefissi.
- **Numeri bloccati** (`blockedNumbers`): lista di numeri E.164 specifici da escludere. Vince sempre sulla allow list.
- **Solo contatti salvati** (`savedContactsOnly`, on/off): se attivo, risponde solo a chi è in rubrica sul telefono paired.
- **Solo non letti** (`unreadOnly`, on/off): se attivo, risponde solo se la chat ha messaggi non letti.

Per filtri più complessi (su contenuto messaggio, su nome contatto, ecc.) non c'è supporto in v1: rules sono solo metadata della chat.

## Modifica delle regole

Due vie equivalenti:

- **Web UI**: `http://localhost:3000`, tab "Filter", modifica e Save.
- **A mano**: edita `config/user-config.yaml`, blocco `filter`, salva.

Non serve riavviare il bot: hot-reload automatico al salvataggio. Se la modifica contiene un errore (YAML invalido, valore fuori schema), il bot lo segnala nei log e tiene la versione precedente attiva. Niente downtime.

## Cosa succede a chi NON è nella regola

Niente. Il bot vede arrivare il messaggio, controlla, decide "non in lista", lo lascia stare. Tu lo vedrai normalmente sul telefono come sempre.

## Aggiungere o rimuovere una persona

Aggiungi/togli il numero da "Allowed prefixes" o "Blocked numbers" via web UI, oppure edita la lista corrispondente nel YAML. Salva. Funziona.

## Esempio di regola scritta (YAML)

```yaml
filter:
  allowedPrefixes:
    - '+84'
  blockedNumbers:
    - '+84111111111'
    - '+84222222222'
  savedContactsOnly: false
  unreadOnly: false
```

Tradotto: solo numeri vietnamiti, escluse due eccezioni.

## Limiti

- Il bot non gestisce mai chat di gruppo, indipendentemente dalla regola.
- La regola si applica al numero, non al contenuto del messaggio. Se vuoi un filtro su parole chiave nel messaggio (es. "rispondi solo se chiede aiuto"), questa è una funzionalità non prevista in questa versione.
