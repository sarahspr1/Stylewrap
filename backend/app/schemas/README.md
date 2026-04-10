# app/schemas

Pydantic models for request validation and response serialization.

Each resource has three schema types:

| Suffix | Used for | Example |
|---|---|---|
| `Base` | Shared fields between create and update | `WardrobeItemBase` |
| `Create` | POST request body | `WardrobeItemCreate` |
| `Update` | PATCH request body (all fields optional) | `WardrobeItemUpdate` |
| `Out` | API response — what the client receives | `WardrobeItemOut` |

## Why separate from models?

SQLAlchemy models define the database schema. Pydantic schemas define the API contract. They are deliberately separate because:

- The API response often includes computed or joined fields not directly on the model
- Some model fields (encrypted columns, internal flags) should never be exposed to the client
- Request bodies accept different fields than what gets stored (e.g. `item_ids` on outfit creation)

## Encrypted fields

`date_of_birth`, `phone`, and `weight_kg` are stored encrypted in the database. Their schemas accept and return plaintext — decryption/encryption happens in the service layer before the data reaches the schema.
