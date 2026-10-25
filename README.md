# Orbit Supply � Lab Task 07, Part 2

Orbit Supply is an independent, navy-and-lime storefront built for Lab 7. It uses persistent REST APIs. Products, accounts, sessions, cart items, and orders are stored in a local SQLite database, rather than JavaScript arrays or prepared HTML examples. A shared responsive theme styles the catalog, accounts, cart, checkout, and receipts.

## Run

Requires Node.js 24 or later. No package installation or database service is needed.

```powershell
npm start
```

Open **http://localhost:3000**. Do not open the HTML files directly: the frontend needs the API server. The server also serves the existing Bootstrap stylesheet from the bundled `assets/bootstrap/bootstrap.min.css`.

1. Sign up with fictional details (password: at least eight characters).
2. Add any combination of products to your cart.
3. Change quantities (1�99), remove items, and continue to checkout.
4. Submit fictional delivery details to save an order and see its receipt.
5. Restart the server and log in again: products, accounts, carts, and orders remain saved.

The database is automatically created at `data/store.sqlite`, with the four original products seeded once. Override `DB_PATH` or `PORT` with environment variables if needed. The server listens on loopback only.

## API endpoints

Requests with a body use `Content-Type: application/json`. Responses are JSON. Errors return `{ "error": "message" }` with the appropriate HTTP status. Authentication uses an HttpOnly, SameSite cookie that expires after seven days. Cart and order endpoints require login and only expose the signed-in user's records.

| Method | Endpoint | Purpose / request body |
| --- | --- | --- |
| GET | `/api/products` | List products |
| GET | `/api/products/:id` | Read one product |
| POST | `/api/products` | Create product: `name`, `description`, `category`, `price`, `image` |
| PUT | `/api/products/:id` | Replace all editable product fields |
| PATCH | `/api/products/:id` | Update selected product fields |
| DELETE | `/api/products/:id` | Delete product and associated cart items |
| POST | `/api/auth/signup` | Create account and session: `name`, `email`, `password` |
| POST | `/api/auth/login` | Log in: `email`, `password` |
| GET | `/api/auth/me` | Read current account |
| POST | `/api/auth/logout` | Delete current session |
| GET | `/api/cart` | Read cart, subtotal, delivery, and total |
| POST | `/api/cart/items` | Add to cart: `productId`, `quantity` (defaults to 1; adds to existing quantity) |
| PATCH | `/api/cart/items/:productId` | Set exact `quantity` |
| DELETE | `/api/cart/items/:productId` | Remove item |
| DELETE | `/api/cart` | Empty cart |
| POST | `/api/orders` | Save order: `firstName`, `lastName`, `email`, `address`, `city`, `postalCode` |
| GET | `/api/orders` | List your saved orders |
| GET | `/api/orders/:id` | Read your order and receipt |

Product prices are positive integer PKR values. Product images use local paths such as `images/bottle.svg`. Delivery is PKR 300 on nonempty carts up to PKR 10,000, and free above PKR 10,000. Prices and totals are calculated on the server; submitted totals are ignored. Placing an order saves product/price snapshots and clears the cart in one transaction. Later product edits or deletion do not change saved receipts.

Example catalog CRUD in PowerShell:

```powershell
$product = Invoke-RestMethod http://localhost:3000/api/products -Method Post -ContentType 'application/json' -Body '{"name":"Travel Bottle","description":"Reusable bottle","category":"Lifestyle","price":4000,"image":"images/bottle.svg"}'
Invoke-RestMethod "http://localhost:3000/api/products/$($product.id)"
Invoke-RestMethod "http://localhost:3000/api/products/$($product.id)" -Method Patch -ContentType 'application/json' -Body '{"price":4500}'
Invoke-RestMethod "http://localhost:3000/api/products/$($product.id)" -Method Delete
```

## Verification

```powershell
npm test
```

The integration test uses an isolated temporary SQLite file and a real HTTP server. It checks catalog CRUD and validation, signup/login/logout, protected access, saved cart quantities across restart, server-calculated totals, delivery thresholds, order persistence and ownership, and receipt preservation after product deletion. It does not modify your store database.

## Classroom scope

Passwords are salted and hashed with scrypt. Database queries are parameterized, and database/server source files are not exposed by the static file server. Catalog CRUD is intentionally public for lab endpoint demonstrations; administrator authorization, HTTPS, and rate limiting are needed before public deployment. Checkout saves a classroom order only; it does not process payment or arrange delivery. Use fictional personal details.

The active app uses index.html, cart.html, checkout.html, confirmation.html, and app.js.
