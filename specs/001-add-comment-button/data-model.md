# Data Model

## Overview

This feature introduces no new entities or persistence. It reuses existing comment draft state and permission data.

## Entities

- No new entities.

## Relationships

- No new relationships.

## Validation Rules

- Existing permission checks govern whether the add comment button is enabled.

## State Transitions

- If a comment draft already exists, the action focuses the existing draft rather than creating a new one.
