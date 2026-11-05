import { useRef, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@momo/workbench/react";
import { t, useLanguage } from "./i18n";

const repository = "https://github.com/BreezyMomo/MomoSoundForge";

export function HelpDialog() {
  const [section, setSection] = useState<"guide" | "license">("guide");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const locale = useLanguage();
  const links = [
    { key: "help.manual", href: `${repository}/blob/main/docs/user-guide${locale === "en" ? ".en" : ""}.md` },
    { key: "help.aiGuide", href: `${repository}/blob/main/docs/ai-authoring.md` },
    { key: "help.repository", href: repository },
    { key: "help.feedback", href: `${repository}/issues` },
  ];
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button ref={trigger} variant="outline" />} aria-label={t("header.help")}>
          {t("header.help")}<ChevronDown size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="sound-help-menu">
          <DropdownMenuItem onClick={() => { setSection("guide"); setOpen(true); }}>{t("help.label")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { setSection("license"); setOpen(true); }}>{t("help.license")}</DropdownMenuItem>
          <DropdownMenuItem render={<a href={`${repository}/blob/main/README${locale === "en" ? ".en" : ""}.md`} target="_blank" rel="noopener noreferrer" />}>
            {t("help.details")}<ExternalLink size={12} aria-hidden="true" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<a href={repository} target="_blank" rel="noopener noreferrer" />}>
            {t("help.repository")}<ExternalLink size={12} aria-hidden="true" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          finalFocus={trigger}
          showCloseButton={false}
          className="sound-help-dialog wb:max-h-[calc(100dvh-2rem)] wb:overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{t(section === "license" ? "help.license" : "help.title")}</DialogTitle>
            <DialogDescription>{t(section === "license" ? "help.licenseIntro" : "help.scope")}</DialogDescription>
          </DialogHeader>
          <div className="sound-help-sections">
            {(section === "license" ? ["samples", "imports", "components"] : ["start", "editing", "saving", "shortcuts"]).map(section => <section key={section}>
              <h3>{t(`help.${section}.title`)}</h3>
              <p>{t(`help.${section}.body`)}</p>
            </section>)}
            <section>
              <h3>{t("help.resources")}</h3>
              <div className="sound-help-links">{(section === "license" ? [
                { key: "help.sampleSources", href: `${repository}/tree/main/samples` },
                { key: "help.thirdParty", href: `${repository}/blob/main/THIRD_PARTY_NOTICES.md` },
              ] : links).map(link => <a key={link.key} href={link.href} target="_blank" rel="noopener noreferrer">{t(link.key)}<ExternalLink size={14} aria-hidden="true" /></a>)}</div>
              {section !== "license" && <p>{t("help.feedbackHint")}</p>}
            </section>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {t("action.close")}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
