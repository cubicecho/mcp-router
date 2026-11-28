import { useState } from 'react';
import { InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Code, CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import type { CreatedApiKey } from '@/lib/api';
import { failureMessage } from '@/lib/failure-message';
import { useCreateApiKey } from '@/lib/queries';
import { toastCopyError } from '@/lib/toast';

const FORM_ID = 'create-api-key-form';

/** What the create-API-key dialog is given. */
export interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Makes an API key: asks for its name, then shows the secret once, with a copy button and how a client sends it.
 *
 * @param props.open - Whether the dialog is open.
 * @param props.onOpenChange - Called with false when it closes; closing forgets the secret.
 * @returns The dialog.
 */
export function CreateApiKeyDialog({ open, onOpenChange }: CreateApiKeyDialogProps) {
  const create = useCreateApiKey();
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const form = useAppForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      try {
        setCreated(await create.mutateAsync(value.name.trim()));
      } catch {
        // Said in the dialog, from the mutation's error.
      }
    },
  });

  const changeOpen = (next: boolean) => {
    if (next === false) {
      setCreated(null);
      form.reset();
      create.reset();
    }
    onOpenChange(next);
  };

  if (created !== null) {
    return (
      <DialogLayout
        open={open}
        onOpenChange={changeOpen}
        title={`${created.apiKey.name} is ready`}
        description="Copy the key now. It is not shown again; if it is lost, revoke it and create another."
        contentClassName="flex flex-col gap-4"
        contentSlot={
          <>
            <CodeBlock
              wrap
              title="API key"
              content={created.key}
              actionSlot={
                <CopyButton variant="ghost" value={created.key} label="Copy API key" onError={toastCopyError} />
              }
            />
            <Alert
              variant="info"
              description={
                <>
                  An MCP client sends it as <Code>Authorization: Bearer {'<key>'}</Code> to <Code>/mcp</Code>,{' '}
                  <Code>/mcp/{'<name>'}</Code> or <Code>/mcp/w/{'<slug>'}</Code>.
                </>
              }
            />
          </>
        }
        footerActionsSlot={(close) => <Button onClick={close} content="Done" />}
      />
    );
  }

  return (
    <DialogLayout
      open={open}
      onOpenChange={changeOpen}
      title="Create API key"
      description="One key per client or agent, so you can revoke one without the others."
      hasUnsavedChanges={() => form.state.isDefaultValue === false}
      contentSlot={
        <form
          id={FORM_ID}
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <InputField
            form={form}
            name="name"
            label="Name"
            required
            autoFocus
            autoComplete="off"
            placeholder="Claude Code on my laptop"
            description="What uses the key, so you know which to revoke."
            validators={{ onChange: ({ value }) => (value.trim() === '' ? 'Name the key.' : undefined) }}
          />
          {create.isError && (
            <Alert
              variant="destructive"
              title="Couldn't create the key"
              description={`${failureMessage(create.error)} Your name for it is still here; try again.`}
            />
          )}
        </form>
      }
      footerActionsSlot={(close) => (
        <>
          <Button type="button" variant="outline" onClick={close} content="Cancel" />
          <form.AppForm>
            <form.SubmitButton form={FORM_ID} createLabel="Create API key" loadingLabel="Creating…" />
          </form.AppForm>
        </>
      )}
    />
  );
}
