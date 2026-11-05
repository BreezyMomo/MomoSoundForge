import { Heart } from "lucide-react";
import { Button, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@momo/workbench/react";
import { t } from "./i18n";

export function SupportDialog() {
  return <Dialog>
    <DialogTrigger render={<Button variant="ghost" />}>
      <Heart size={16} aria-hidden="true" />{t("support.title")}
    </DialogTrigger>
    <DialogContent showCloseButton={false} className="sound-support-dialog wb:max-h-[calc(100dvh-2rem)] wb:overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t("support.title")}</DialogTitle>
        <DialogDescription>{t("support.description")}</DialogDescription>
      </DialogHeader>
      <figure className="sound-support-code">
        <img src={`${import.meta.env.BASE_URL}wechat-appreciation.png`} alt={t("support.imageAlt")} width={1129} height={1129} />
        <figcaption>{t("support.scan")}</figcaption>
      </figure>
      <DialogFooter><DialogClose render={<Button variant="outline" />}>{t("action.close")}</DialogClose></DialogFooter>
    </DialogContent>
  </Dialog>;
}
