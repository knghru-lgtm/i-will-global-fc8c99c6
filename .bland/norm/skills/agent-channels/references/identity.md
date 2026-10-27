# Identity: contact card, branded caller ID, RCS sender

Routes behind Configure > Identity
(`/dashboard/agent/<agent id>/configure/identity`). What each part does, its
states and its waits are in [how it works](how-it-works.md#identity). This
page is the route dictionary and the setup order.

## Contents

- [Routes](#routes)
- [Read first](#read-first)
- [Contact card and switches](#contact-card-and-switches)
- [Send a test card](#send-a-test-card)
- [Branded caller ID](#branded-caller-id)
- [RCS sender](#rcs-sender)

## Routes

| Route | Body | Returns, notes |
|---|---|---|
| `GET /v2/agents/<agent id>/identity` | | The identity: card fields, `logo_url` and `vcf_url` (links that expire after about an hour), the three switches, `bcid_status`, `bcid_submission`, `phone_numbers` (bound numbers, newest attached first). The first read creates it from the agent's name. |
| `PUT /v2/agents/<agent id>/identity` | Any of `display_name`, `tagline`, `support_email`, `website`, `address`, `vcf_delivery_enabled`, `rcs_enabled`, `bcid_enabled` | The identity. Partial: only sent keys change. Live at once. |
| `POST /v2/agents/<agent id>/identity/logo` | Multipart `file` | Dashboard only: ask the user to upload the logo on the page. |
| `GET /v2/agents/<agent id>/identity/contact-card.vcf` | | The contact file as text. |
| `GET /v2/agents/<agent id>/identity/bcid` | | The identity with `bcid_status` re-read from carrier review. The plain GET returns the stored status. |
| `POST /v2/agents/<agent id>/identity/bcid/submit` | See [Branded caller ID](#branded-caller-id) | The identity with the new status. |
| `POST /v2/agents/<agent id>/identity/contact-card/test` | `{"to": "+1…", "channel": "sms" \| "imessage" \| "rcs"}` | `{channel, to, from, delivered_via, message_sid, note?}` |
| `GET /v1/messaging/rcs/<number>` | | The number's RCS sender, or `null`. Add `?refresh=true` to re-check status now. |
| `POST /v1/messaging/rcs/<number>/…` | `sender`, `test-devices`, `registrations/google`, `registrations/us`, `submit`, `attach` | The page wizard's steps. Use the page. |

URL-encode the number in a path (`%2B1…`). Writes need a role that can edit
agents. A connection made with OAuth gets `oauth_path_not_allowed` on every
route here: send the user to the Identity page.

## Read first

1. `bland_api_get` `/v2/agents/<agent id>/identity`.
2. `phone_numbers` empty: branded caller ID, RCS and test cards need a bound
   number. Attaching one belongs to the phone-numbers skill.
3. For RCS, `bland_api_get` `/v1/messaging/rcs/<number>` for each number the
   user means.

Identity is not versioned. Never save or promote the agent to change it.

## Contact card and switches

PUT only the keys that change. A card field change rebuilds the contact file
at once; people who already received the card keep their copy.

| Switch | On means | Confirm |
|---|---|---|
| `vcf_delivery_enabled` | Each person gets the card once, with the next SMS or iMessage reply the agent sends them (people already in a thread included). Billed as a message. | Yes: it texts real people. |
| `rcs_enabled` (default on) | Texts on the agent's numbers use the RCS sender when it is live. Off sends plain SMS; the sender stays set up. | No |
| `bcid_enabled` | Calls count as branded once the application is approved. | No |

## Send a test card

One real, billed message to `to`, whatever the switches say. Quote the
recipient, the channel and the from-number, then confirm.

- `sms`: the contact file by MMS from the agent's newest bound number.
- `imessage`: from the first of the agent's numbers with iMessage on.
- `rcs`: a short test message, so the handset shows the verified sender.
  Before the sender is Online, only an accepted test device receives it.

The test lands in a real thread with that number. At most 5 tests per minute
per agent (429 `TOO_MANY_REQUESTS`); 402 when the balance does not cover a
message; 409 with `error` `NO_BOUND_NUMBER`, `NO_RCS_SENDER`,
`RCS_SENDER_NOT_READY` or `IMESSAGE_NOT_CONFIGURED` and a message that says
what to fix.

## Branded caller ID

The application goes to the carriers and cannot be withdrawn here.

1. Read `bcid_status`. `pending_review` or `approved`: stop and say a new
   application replaces it and restarts carrier review. `submitted`: it is
   already with Bland; do not submit again (a second submit makes a second
   application).
2. If the brand should show a logo, ask the user to upload it on the page
   first. The application records the logo on file when it is submitted.
3. Build the body:

   ```json
   {
     "display_name": "Example Dental",
     "call_reason": "Appointment reminders",
     "category": "healthcare",
     "phone_numbers": ["+15550000000"],
     "carriers": ["tmobile", "verizon"],
     "attest": true
   }
   ```

   (Synthetic example.) `display_name` up to 30 characters and close to the
   legal business name; `call_reason` up to 60; `category` one of
   `customer_service`, `sales`, `survey`, `healthcare`, `financial`, `other`;
   numbers bound to this agent; carriers `tmobile` and/or `verizon` (AT&T is
   not covered); `attest: true` only after the user confirms the details are
   accurate. Add `"resubmit": true` only to replace an approved or in-review
   application, after its own confirm.
4. REQUIRED confirm, quoting the name, reason, numbers and carriers. Then
   `call_bland_api` POST `/v2/agents/<agent id>/identity/bcid/submit`.
5. Turn `bcid_enabled` on if it is off. Report the status and the page's
   review estimate: T-Mobile about 5 to 7 business days, Verizon about 7
   to 10. Check later with `GET …/identity/bcid`.

Errors: 400 names the field (`Phone numbers not bound to this agent: …`,
`Unsupported carrier(s)`, `attest must be true`); 409
`BCID_ALREADY_SUBMITTED` when an approved or in-review application exists
and `resubmit` is absent.

## RCS sender

RCS is per number and is offered to enterprise orgs. The wizard collects
branding, business details, contact details, test devices and two
compliance registrations, then submits; send the user to it:
`/dashboard/agent/<agent id>/configure/identity?setup=rcs&phone=<number>`.

Through the API, read and report only:

- `status`: report the page's label (Creating, Draft, In review, Pending
  verification, Online, Offline), not the raw value.
- `attached`: whether texts on this number can use the sender yet.
- `test_devices`: each with `PENDING` until the person accepts on the
  phone, then `ACTIVE`.

Before the user submits on the page, say that branding (name, logo, color,
description) locks for good at submission and review takes about a week.
