import { useId, useState } from "react";

import { Alert, AlertDescription } from "./alert";
import { Button } from "./button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "./card";
import { Checkbox } from "./checkbox";
import { Field, FieldLabel } from "./field";
import { Spinner } from "./spinner";
import { Textarea } from "./textarea";

export interface RouteNote {
	content: string;
	savedAt: Date | null;
}

export type RouteNoteCardState =
	| { status: "unavailable" }
	| { status: "ready"; note: RouteNote | null };

export interface RouteNoteCardProps {
	state: RouteNoteCardState;
	maxLength: number;
	isSaving: boolean;
	isRemoving: boolean;
	onSave: (content: string) => Promise<unknown>;
	onRemove: () => void;
	labels: {
		title: string;
		description: string;
		noteLabel: string;
		placeholder: string;
		consent: string;
		save: string;
		saving: string;
		correct: string;
		cancel: string;
		remove: string;
		removing: string;
		unavailable: string;
		savedAt: (date: Date) => string;
	};
}

export function RouteNoteCard({
	state,
	maxLength,
	isSaving,
	isRemoving,
	onSave,
	onRemove,
	labels,
}: RouteNoteCardProps) {
	const noteInputId = useId();
	const consentId = useId();
	const savedNote = state.status === "ready" ? state.note : null;
	const [draft, setDraft] = useState<string | null>(null);
	const [consented, setConsented] = useState(false);
	const editing = draft !== null || !savedNote;
	const busy = isSaving || isRemoving;
	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>{labels.title}</CardTitle>
				<CardDescription>{labels.description}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{state.status === "unavailable" ? (
					<Alert>
						<AlertDescription>{labels.unavailable}</AlertDescription>
					</Alert>
				) : editing ? (
					<form
						className="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							const content = (draft ?? "").trim();
							if (!content || !consented || busy) return;
							onSave(content)
								.then(() => {
									setDraft(null);
									setConsented(false);
								})
								.catch(() => undefined);
						}}
					>
						<Field>
							<FieldLabel htmlFor={noteInputId}>{labels.noteLabel}</FieldLabel>
							<Textarea
								id={noteInputId}
								value={draft ?? ""}
								maxLength={maxLength}
								placeholder={labels.placeholder}
								disabled={busy}
								onChange={(event) => setDraft(event.target.value)}
							/>
						</Field>
						<Field orientation="horizontal">
							<Checkbox
								id={consentId}
								checked={consented}
								disabled={busy}
								onCheckedChange={setConsented}
							/>
							<FieldLabel htmlFor={consentId} className="font-normal">
								{labels.consent}
							</FieldLabel>
						</Field>
						<div className="flex flex-wrap gap-2">
							<Button
								type="submit"
								className="min-h-11"
								disabled={!draft?.trim() || !consented || busy}
							>
								{isSaving ? <Spinner data-icon="inline-start" /> : null}
								{isSaving ? labels.saving : labels.save}
							</Button>
							{savedNote ? (
								<Button
									type="button"
									variant="outline"
									className="min-h-11"
									disabled={busy}
									onClick={() => {
										setDraft(null);
										setConsented(false);
									}}
								>
									{labels.cancel}
								</Button>
							) : null}
						</div>
					</form>
				) : (
					<>
						<blockquote className="border-primary border-l-2 pl-3">
							<p className="whitespace-pre-wrap">{savedNote.content}</p>
							{savedNote.savedAt ? (
								<p className="type-data text-muted-foreground">
									{labels.savedAt(savedNote.savedAt)}
								</p>
							) : null}
						</blockquote>
						<div className="flex flex-wrap gap-2">
							<Button
								variant="outline"
								className="min-h-11"
								disabled={busy}
								onClick={() => setDraft(savedNote.content)}
							>
								{labels.correct}
							</Button>
							<Button
								variant="outline"
								className="min-h-11"
								disabled={busy}
								onClick={onRemove}
							>
								{isRemoving ? <Spinner data-icon="inline-start" /> : null}
								{isRemoving ? labels.removing : labels.remove}
							</Button>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}
