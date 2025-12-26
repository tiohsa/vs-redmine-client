# Data Model

## Overview

This feature introduces no new entities or persistence. It reuses existing ticket draft state and permission data.

## Entities

- No new entities.

## Relationships

- No new relationships.

## Validation Rules

- Existing permission checks govern whether the add icon is enabled.

## State Transitions

- If a ticket draft already exists, the action focuses the existing draft rather than creating a new one.
