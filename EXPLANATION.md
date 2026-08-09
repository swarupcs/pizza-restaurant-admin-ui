# admin-ui — code walkthrough

How this app is put together, file by file and component by component.

This is the **internals** document. It explains *why the code looks the way it
does*, which is the part that is hard to recover from reading it cold. The
`README.md` in this repo is still the stock Vite template and describes nothing
about this application.

---

## 1. What this app owns

admin-ui is the back-office dashboard. Two kinds of people use it:

| Role | Sees |
| --- | --- |
| `admin` | Everything, across every restaurant — plus Users and Restaurants |
| `manager` | Their own restaurant's products and orders |

A third role exists in the platform, `customer`, and this app is not meant for
them. Enforcing that turns out to be the weakest part of the design — see §9.

| Responsibility | Detail |
| --- | --- |
| Authentication | Login, session bootstrap, silent token refresh |
| Users and tenants | CRUD against auth-service (admin only) |
| Products | Create and edit against catelog-service, with per-category pricing |
| Orders | List, inspect, and advance through fulfilment states |
| Live orders | A socket.io client that pushes new orders into the table |

It is a **Vite SPA**, not a framework app: `createBrowserRouter`, client-side
only, no SSR and no server of its own. `vercel.json` rewrites every path to
`index.html`, which is what makes deep links like `/orders/abc` work on a static
host.

### The stack, and what each piece is actually for

- **antd 6** — every visual element. There is no custom CSS beyond `index.css`.
- **TanStack Query** — all server state. There is no `useEffect`-and-`fetch`
  anywhere except the socket wiring.
- **zustand** — *only* the logged-in user. One store, three fields.
- **axios** — one shared instance, with the refresh interceptor that makes the
  whole session model work.

That split is worth stating plainly because it is consistent: **server data
lives in Query, identity lives in zustand, and nothing else is global.** Filter
state, drawer state and pagination are all local `useState` inside the page that
owns them.

---

## 2. The session model

This is the part to understand first, because four files cooperate to produce it
and no single one of them tells the whole story.

```
main.tsx  →  RouterProvider
                │
                ▼
           Root  (path "/")
                │  useQuery(['self']) → GET /api/auth/auth/self
                │  on success: setUser(data)   ← zustand
                │  while loading: renders "Loading..." and nothing else
                ▼
        ┌───────┴────────┐
        ▼                ▼
   Dashboard         NonAuth  (path "/auth")
   user === null?    user !== null?
     → /auth/login     → redirect to ?returnTo
   otherwise           otherwise
     → sidebar +         → login form
       <Outlet/>
```

**Nothing stores a token.** auth-service sets `accessToken` and `refreshToken` as
httpOnly cookies; `axios` is created with `withCredentials: true` and the browser
does the rest. The app's only notion of "logged in" is whether `GET /auth/self`
succeeded.

**`Root` is a gate disguised as a layout.** It renders `"Loading..."` — a bare
div, no spinner — until the `self` query settles, so no child route can render
before the user is known. That is why `Dashboard` can safely do
`if (user === null) return <Navigate .../>` without a race.

**`Root`'s retry policy is the interesting line:**

```ts
retry: (failureCount, error) => {
  if (error instanceof AxiosError && error.response?.status === 401) return false;
  return failureCount < 3;
}
```

A 401 is not a failure to retry — it is the answer, and it means "not logged
in". Anything else (a gateway hiccup, a cold start) gets three attempts. Without
this, an unauthenticated visitor would sit on `"Loading..."` through four
sequential 401s before seeing the login form.

**`returnTo` round-trips through the query string.** `Dashboard` redirects to
`/auth/login?returnTo=${location.pathname}`, and `NonAuth` reads it back and
navigates there once a user appears. That is the whole deep-link-after-login
mechanism.

---

## 3. `src/http/client.ts` — the refresh interceptor

The single most load-bearing file in the app:

```ts
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response.status === 401 && !originalRequest._isRetry) {
      try {
        originalRequest._isRetry = true;
        const headers = { ...originalRequest.headers };
        await refreshToken();
        return api.request({ ...originalRequest, headers });
      } catch (err) {
        console.error('Token refresh error', err);
        useAuthStore.getState().logout();
        return Promise.reject(err);
      }
    }

    return Promise.reject(error);
  }
);
```

What it buys: **a 15-minute access token behaves like an infinite session.** Any
request that comes back 401 triggers `POST /auth/refresh` — which mints a new
access-token cookie from the refresh-token cookie — and then replays the original
request. The caller never sees the 401 and no component contains a single line
about token expiry.

Three details:

- **`_isRetry` is set on the request config, not in a closure.** It rides along
  with the replayed request, so a second 401 on the same request falls straight
  through to `Promise.reject`. Without it, an expired *refresh* token would
  produce an infinite refresh loop.
- **`refreshToken()` uses a bare `axios.post`, not `api`.** Deliberate: routing it
  through `api` would put the refresh call itself under this interceptor.
- **`useAuthStore.getState().logout()`** — called outside React, which is exactly
  what zustand's non-hook accessor exists for. This is the only place the store is
  touched from non-component code.

`error.response.status` is read without a guard; see §9.

### `src/http/api.ts`

A flat list of functions, one per endpoint, grouped by service. No classes, no
generated client. Note the three prefixes:

```ts
export const AUTH_SERVICE = '/api/auth';
const CATALOG_SERVICE = '/api/catalog';
const ORDER_SERVICE = '/api/order';
```

Every call goes to `VITE_BACKEND_API_URL` + one of these — the app talks to a
single origin (the api-gateway) and never to a service directly. `AUTH_SERVICE`
is the only one exported, because `client.ts` needs it to build the refresh URL.

The double `auth` in `/api/auth/auth/login` is not a typo: the gateway prefix is
`/api/auth` and auth-service's own router is mounted at `/auth`.

---

## 4. Login, and where the role is checked

```ts
onSuccess: async () => {
  const selfDataPromise = await refetch();
  if (!isAllowed(selfDataPromise.data)) {
    logoutMutate();
    return;
  }
  setUser(selfDataPromise.data);
}
```

The login mutation does **not** put the user in the store directly. It logs in,
then re-runs the `self` query (`enabled: false` on that `useQuery` means it exists
only to be `refetch`ed), and only commits the result to zustand if
`usePermission().isAllowed` passes:

```ts
const allowedRoles = ['admin', 'manager'];
```

So a customer who signs in here is immediately signed out again. The commented
line above it — `// window.location.href = "http://clientui/url"` — shows the
intended behaviour: bounce them to the storefront rather than nowhere. As
written, they land back on the login form with no explanation.

**This is the only role check on the way in, and it is on the wrong side of the
door.** §9.

---

## 5. Products — the most interesting code in the app

catelog-service's price model is per-category: a category declares *which*
options exist (`Size: [Small, Medium, Large]`), and a product supplies *what each
one costs*. Rendering a form for that means the form's shape is not known until
the user picks a category, and each field needs to carry two extra facts — which
configuration key it belongs to, and whether that key is `base` or `aditional`
pricing.

antd's `Form.Item` addresses fields by a path array. The trick used here is to
**make one path segment a JSON string**:

```tsx
name={[
  'priceConfiguration',
  JSON.stringify({ configurationKey, priceType: configurationValue.priceType }),
  option,
]}
```

which produces a form value shaped like:

```js
{
  '{"configurationKey":"Size","priceType":"base"}':      { Small: 400, Large: 800 },
  '{"configurationKey":"Crust","priceType":"aditional"}': { Thin: 0, Thick: 50 },
}
```

and on submit, `Products.tsx` parses the key back apart:

```ts
const pricing = Object.entries(priceConfiguration).reduce((acc, [key, value]) => {
  const parsedKey = JSON.parse(key);
  return { ...acc, [parsedKey.configurationKey]: { priceType: parsedKey.priceType, availableOptions: value } };
}, {});
```

recovering exactly the shape catelog-service wants. The **edit** path runs the
same transformation in reverse inside a `useEffect`, so `form.setFieldsValue` can
repopulate a drawer from a fetched product.

It is a real technique, not a hack — the JSON string is an opaque composite key —
but it means **`priceType` survives a round trip through the DOM as part of a
field name**, and it is why the same `JSON.stringify({ configurationKey, priceType })`
expression appears in two files that must agree exactly. Change one and the form
silently produces `undefined` prices.

Note the misspelling `aditional` is load-bearing here too: it comes from
catelog-service's enum and is embedded in these keys.

### `helpers.ts` — `makeFormData`

The product endpoints are `multipart/form-data`, because a product carries an
image. `FormData` values are strings, so:

```ts
if (key === 'image')                                    → append the File
else if (key === 'priceConfiguration' || 'attributes')  → append JSON.stringify(value)
else                                                    → append as-is
```

catelog-service's validators expect exactly that: two JSON strings and a file.

### `ProductForm` and its children

`Form.useWatch('categoryId')` drives conditional rendering — `Pricing` and
`Attributes` mount only once a category is chosen. Both fetch the *same* category
with the same query key and a five-minute `staleTime`, so TanStack Query
deduplicates it into one request despite two components asking.

`Attributes` renders a `Radio.Group` or a `Switch` depending on the category's
declared `widgetType`, with `initialValue` from `defaultValue` — the category
document is genuinely driving the form.

`ProductImage` uses antd's `Upload` with `beforeUpload` returning `false`, which
is how you turn antd's uploader into a plain file picker: it never uploads
anything itself, it just hands the `File` to the form so `makeFormData` can post
it with the rest.

---

## 6. Orders, and the live feed

`Orders.tsx` is the only place the socket is used:

```ts
React.useEffect(() => {
  if (user?.tenant) {
    socket.on('order-update', (data) => {
      if ((data.event_type === ORDER_CREATE && data.data.paymentMode === CASH) ||
          (data.event_type === PAYMENT_STATUS_UPDATE && data.data.paymentStatus === PAID
                                                     && data.data.paymentMode === CARD)) {
        queryClient.setQueryData(['orders'], (old: Order[]) => [data.data, ...old]);
        messageApi.open({ type: 'success', content: 'New Order Received.' });
      }
    });
    socket.on('join', (data) => console.log('User joined in: ', data.roomId));
    socket.emit('join', { tenantId: user.tenant.id });
  }
  return () => { socket.off('join'); socket.off('order-update'); };
}, []);
```

**The filtering ws-service does not do happens here.** ws-service broadcasts every
event on the `order` topic; this condition narrows it to the two that mean "a new
order is now real and payable": a cash order the moment it is created, and a card
order the moment Stripe confirms payment. A card order that has been *created* but
not paid deliberately does not appear.

**`setQueryData` prepends rather than invalidating.** No refetch, no network — the
event payload *is* the order, because order-service publishes the full document
with the customer populated. That is the entire reason the event carries so much.

`src/lib/socket.ts` creates the client at module scope, so the connection opens
when the module is first imported and lives for the tab's lifetime. There is no
`auth` option on it — no token is sent, which matches ws-service, which checks
none.

### `SingleOrder.tsx`

Requests an explicit `fields` projection:

```
fields=cart,address,paymentMode,tenantId,total,comment,orderStatus,paymentStatus,createdAt
```

`customerId` is conspicuously absent — and that is correct, not an oversight:
order-service seeds its projection with `{ customerId: 1 }` and populates it
unconditionally, so asking for it again would be redundant. The status dropdown
`PATCH`es and then invalidates `['order', orderId]`.

It carries a `todo: IMPORTANT: check why there is a nested array in selected
toppings`, which is a real question about client-ui's cart shape rather than
about this file.

---

## 7. Users and tenants

Both pages are the same shape, and it is the shape every list page in this app
uses:

```
useState(queryParams)  ──▶  useQuery(['users', queryParams])   placeholderData: keepPreviousData
        ▲                            │
        │                            ▼
  onFilterChange              antd <Table> + pagination
   (debounced for `q`)
```

Three things are worth extracting from it:

- **`keepPreviousData`** is what stops the table flashing empty on every page
  change. The old rows stay while the new page loads.
- **The search box is debounced by 500ms; the dropdowns are not.** `onFilterChange`
  branches on whether `'q' in changedFilterFields` — typing should not fire a
  request per keystroke, but picking a role should be instant.
- **Every filter change resets to page 1.** Otherwise filtering while on page 4
  would show an empty table.

`Users` and `Tenants` both open with `if (user?.role !== 'admin') return <Navigate to="/" />`.
That check is real, and it is the only per-page role gate in the app — `Products`
and `Orders` have none.

`Users` runs two separate mutations rather than one branching mutation, and picks
between them in `onHandleSubmit` on `!!currentEditingUser`. `UserForm` hides the
password card entirely in edit mode, because auth-service's update endpoint does
not accept one.

---

## 8. Configuration and build

Two environment variables, both `VITE_`-prefixed so Vite inlines them into the
bundle:

| Variable | Purpose |
| --- | --- |
| `VITE_BACKEND_API_URL` | The api-gateway origin — every REST call |
| `VITE_SOCKET_SERVICE_URL` | ws-service, for the live order feed |

**`VITE_` variables are compiled into the JavaScript that ships to the browser.**
Nothing secret can go here, and nothing does.

`vercel.json` rewrites all paths to `index.html` — mandatory for a
`createBrowserRouter` SPA on static hosting, or `/orders/abc` 404s on refresh.

`vite.config.ts` doubles as the vitest config: `jsdom`, `globals: true`, and
`setupTest.ts`, which stubs `matchMedia` — antd's responsive components call it at
render time and jsdom does not implement it.

---

## 9. Known issues

Unlike the backend services, none of these is currently pinned by a test —
this app has exactly one test (§10).

### The one to fix first

**A `customer` who is already logged in can open the dashboard.** The role check
lives in `login.tsx`'s `onSuccess` and nowhere else. `Root` calls `/auth/self` and
commits whatever it gets to the store; `Dashboard` then asks only
`if (user === null)`. So a customer who signed in on client-ui — same cookie
domain, same auth-service — and then navigates to admin-ui is handed the dashboard
layout, the sidebar, and the Products and Orders pages.

The API calls behind them will mostly 403, so this is a UI-exposure problem rather
than a data breach, but it is exactly the sort of gap that becomes one the moment
a backend authorization check is missed. `usePermission` already exists and is
already imported in one file; `Dashboard` should use it too.

### Orders

**The orders list is hardcoded to tenant 10.**

```ts
// todo: make this dynamic.
const TENANT_ID = 10;
```

Every request is `getOrders('tenantId=10')`, regardless of who is logged in. A
manager at restaurant 3 does not see their own orders — they see restaurant 10's,
or nothing. This makes the Orders page non-functional for everyone except by
coincidence. The value is right there in `user.tenant.id`, which the socket
`join` two lines above already uses.

**Admins never receive live updates.** The socket block is inside
`if (user?.tenant)`, and an admin has no tenant. Defensible — an admin has no
single room to join — but it means the feature silently does nothing for them,
with no indication why.

**The socket effect has an empty dependency array but reads `user`.** It works
only because `Dashboard` guarantees a non-null user before this component
mounts. It is a latent bug rather than a live one, and `react-hooks/exhaustive-deps`
would flag it.

**`setQueryData(['orders'], (old: Order[]) => [data.data, ...old])` assumes `old`
exists.** If an event arrives before the initial fetch resolves, `old` is
`undefined` and spreading it throws inside the socket callback.

**A live-inserted order can duplicate on refetch,** since it is prepended to the
cache rather than invalidated, and the next background refetch will contain it
too. antd's `rowKey="_id"` means React handles it, but the row can appear twice
in the interim.

### Products

**A non-JPG/PNG file is rejected in the message and accepted in the form.**
`beforeUpload` shows the error toast and then falls through to
`setImageUrl(URL.createObjectURL(file))` and `return false` regardless. There is
also a `todo: size validation` and no size check at all, so the browser will
happily start a multi-megabyte multipart POST.

**`rowKey={'id'}` on the products table,** where products are keyed `_id`. Every
row gets `undefined` as its key. (`Users`, `Tenants` and `Orders` all get this
right.)

**The two `JSON.stringify({ configurationKey, priceType })` expressions must stay
byte-identical** across `Pricing.tsx` and `Products.tsx`. Nothing enforces it —
not a shared helper, not a type. A reordered property would break pricing
silently.

### Interceptor

**`error.response.status` is read without a guard.** On a network failure, a CORS
rejection or a request the browser cancelled, `error.response` is `undefined` and
the interceptor throws a `TypeError` that replaces the real error. Every failed
request during a backend outage surfaces as "Cannot read properties of
undefined".

**A failed refresh rejects with the refresh error, not the original.** The caller
sees "Request failed with status code 401" from `/auth/refresh` rather than
anything about the request they actually made.

### Cosmetic and dead

**The entire home page is fake.** `Total orders 52`, `Total sale ₹70,000`, and a
hardcoded six-item `list` of invented orders with addresses in Mumbai and West
Bengal. The "Sales" card is an empty `<Card>` where a chart should be. It is the
first screen every user sees after logging in.

**The sidebar links to `/promos`, which has no route.** Clicking it leaves the
router with no match.

**`capitalizeFirst` throws on an empty string** — `str[0].toUpperCase()` with no
guard.

**`colorMapping[record.orderStatus]` has no fallback in `Orders.tsx`** where
`SingleOrder.tsx` writes `?? 'processing'`. An unrecognised status renders an
uncoloured tag.

**Stray `console.log`s ship to production** — in `Products`, `ProductForm`,
`Users`, `helpers.ts`, the pagination handlers, and the socket handler, which
logs every received order payload including the customer's details.

**`README.md` is the unmodified Vite starter template.**

---

## 10. Where the tests live

```
src/pages/login/login.spec.tsx    1 test — the login form renders its fields
setupTest.ts                      stubs matchMedia for antd
```

That is the entire suite: one render assertion. `vitest` is configured and
working (`npm test`), the jsdom environment is set up, and `@testing-library/react`
plus `jest-dom` are installed — so the harness is ready and essentially unused.

The one harness detail worth knowing is why `setupTest.ts` exists: antd's
responsive components call `window.matchMedia` during render, jsdom does not
implement it, and without the stub every antd component throws on mount rather
than failing an assertion.

The gaps that matter most, in the order I would close them: the `Root` →
`Dashboard` → `NonAuth` gate chain (which is where §9's first bug lives), the
refresh interceptor (`_isRetry`, the logout-on-failed-refresh path, and the
missing `error.response` guard), and the price-configuration round trip in
`Products` — the JSON-key encode and decode, which is the one piece of logic here
complex enough to break without anyone noticing.
