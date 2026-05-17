# Who it replies to

## The basic idea

You define "rules" that decide, for each chat, whether the bot should handle it or ignore it. The rules are declarative: lists of allowed numeric prefixes, blocked numbers, "saved contacts only" flag, "only chats with unread messages" flag. They are edited via the web UI (`http://localhost:3000`, Filter tab) or by hand in `config/user-config.yaml` (`filter` block).

## Typical example

Realistic example: you want the bot to reply only to people with a Vietnamese number, excluding two specific numbers (the aunt, the accountant) and ignoring contacts saved in the address book.

Expressed in words:

> Reply if the number starts with +84 AND it is not one of the two blacklisted numbers.

## Possible rule types

There are 4 rules (combinable: passes only if ALL applicable checks pass):

- **Allowed prefixes** (`allowedPrefixes`): list of E.164 prefixes (e.g. `+84`, `+39`). Empty = no prefix filter. OR logic between prefixes.
- **Blocked numbers** (`blockedNumbers`): list of specific E.164 numbers to exclude. Always wins over the allow list.
- **Saved contacts only** (`savedContactsOnly`, on/off): if on, replies only to those in the address book on the paired phone.
- **Unread only** (`unreadOnly`, on/off): if on, replies only if the chat has unread messages.

For more complex filters (on message content, on contact name, etc.) there is no support in v1: rules are only chat metadata.

## Editing the rules

Two equivalent paths:

- **Web UI**: `http://localhost:3000`, "Filter" tab, edit and Save.
- **By hand**: edit `config/user-config.yaml`, `filter` block, save.

No need to restart the bot: automatic hot-reload on save. If the change contains an error (invalid YAML, value out of schema), the bot reports it in the logs and keeps the previous version active. No downtime.

## What happens to those NOT in the rule

Nothing. The bot sees the message arrive, checks, decides "not on the list", leaves it alone. You will see it normally on the phone as always.

## Adding or removing a person

Add/remove the number from "Allowed prefixes" or "Blocked numbers" via the web UI, or edit the corresponding list in the YAML. Save. It works.

## Example of a written rule (YAML)

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

Translated: only Vietnamese numbers, with two exceptions excluded.

## Limits

- The bot never handles group chats, regardless of the rule.
- The rule applies to the number, not the message content. If you want a filter on keywords in the message (e.g. "reply only if she asks for help"), this is a feature not planned for this version.
