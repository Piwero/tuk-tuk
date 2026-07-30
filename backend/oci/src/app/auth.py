"""Argon2id password hashing (ADR 0005).

Parameters are tuned so verification costs roughly 200ms on the target
platform, which is itself the primary brute-force control. Because a PHC
string encodes its own parameters, a deployed hash's cost travels with it
rather than living in application code.
"""

from argon2 import PasswordHasher
from argon2.low_level import Type

password_hasher = PasswordHasher(
    time_cost=5,
    memory_cost=262144,
    parallelism=4,
    type=Type.ID,
)
