import {
  Button,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@momo/workbench/react";
import { t } from "./i18n";

export function HelpDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" />}
        aria-label={t("header.help")}
      >
        {t("header.help")}
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="sound-help-dialog wb:max-h-[calc(100dvh-2rem)] wb:overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("help.title")}</DialogTitle>
          <DialogDescription>{t("help.scope")}</DialogDescription>
        </DialogHeader>
        <p className="sound-help-copy">{t("help.body")}</p>
        <p className="wb:text-muted-foreground">{t("help.keys")}</p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {t("action.close")}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
