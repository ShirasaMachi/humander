---
name: humander
description: Open or continue a human-led research organization through the Humander MCP App. Use when the human asks to begin, inspect or continue a Humander project.
version: 0.1.0
---

Call `humander_open` to show the interactive human panel. The human configures providers, workers, secretary and project rules there. Human decisions, including ratifying the research definition, belong in that panel.

After the human starts or resumes the project, call `humander_advance` to perform one bounded protocol phase. Continue while useful and within the task's time budget. Read `humander_status` after an advance to see whether the project needs human attention. Stop when a draft needs ratification, the project is paused/completed, or an error needs human repair. Do not imitate worker or secretary output in the WorkBuddy conversation: their model sessions and records are controlled by the Humander runtime.

Never call hidden panel tools or claim that a model score proves a scientific result. The human may inspect and correct the panel's exact meeting records.
