// Copyright (C) 2016  Patrick Maué
// 
// This file is part of vscode-journal.
// 
// vscode-journal is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// 
// vscode-journal is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
// 
// You should have received a copy of the GNU General Public License
// along with vscode-journal.  If not, see <http://www.gnu.org/licenses/>.
// 
import { defer } from 'Q';
import { log } from 'util';
import { create } from 'domain';

'use strict';

import * as vscode from 'vscode';
import * as os from 'os';
import * as Path from 'path';
import * as fs from 'fs';
import * as Q from 'q';
import * as util from './util';





const SCOPE_DEFAULT = "default";


interface Root {
    scopes: Scope[];
}

interface Scope {
    name: string;
    note: Note;
    entry: Entry;
}

export interface InlineTemplate {
    scope: string; 
    id: string;
    template: string;
    after: string;
}

interface Page {
    templates: InlineTemplate[];
    path: string;
    file: string;
}

interface Note extends Page { }
interface Entry extends Page { }


function findScope(scopes: Scope[], scopeId?: string): Scope {
    return scopes.find((val: Scope) => {
        let bool = val.name.startsWith(scopeId ? scopeId : SCOPE_DEFAULT);

        return (val.name.startsWith(scopeId ? scopeId : SCOPE_DEFAULT))
    });
}
function findTemplate(templates: InlineTemplate[], templateId: string, ): InlineTemplate {
    let result: InlineTemplate = templates.find((val: InlineTemplate) => val.id.startsWith(templateId));

    return result;
}




export class TemplateInfo {
    public template: string;
    public flags: string[];
    public after: string;

    constructor() { }

    static create(_template: string, _flags: string[], _after: string): TemplateInfo {
        let ti: TemplateInfo = new TemplateInfo();
        ti.template = _template;
        ti.flags = _flags;
        ti.after = _after;

        return ti;
    }

    static createFromJson(val: any): TemplateInfo {
        let ti: TemplateInfo = new TemplateInfo();
        if (val) {
            ti.template = val["template"];
            ti.flags = val["flags"];
            ti.after = val["after"];
        }
        return ti;
    }
}

/**
 * All config parameters in one place
 */
export class Configuration {

    private inlineTemplates: Root = null;

    constructor(public config: vscode.WorkspaceConfiguration) {

    }



    public getLocale(): string {
        let locale: string = this.config.get<string>('locale');
        return (locale.length > 0) ? locale : 'en-US';
    }

    public isOpenInNewEditorGroup(): boolean {
        return this.config.get<boolean>('openInNewEditorGroup');
    }

    public isDevEnabled(): boolean {
        let dev: boolean = this.config.get<boolean>('dev');
        return (dev) ? dev : false;
    }

    public getBasePath(): string {

        let base = this.config.get<string>('base');

        if (base.length > 0) {
            return Path.resolve(base);
        } else {
            // let's default to home directory
            return Path.resolve(os.homedir(), "Journal");
        }
    }

    /**
     * Returns a valid path, replaces variables with their counterparts
     * @param pathStr 
     */
    private resolvePath(pathStr: string): string {
        let result: string = pathStr; 
        
        pathStr.match(/\$\{.+\}/).forEach((token:string) => {
            result = result.replace(token, this.replacePlaceholder(token)); 
        }); 

        return result; 

    }

    private replacePlaceholder(variableStr: string) {
        switch (variableStr) {
            case "${journalFolder}":
                return this.getBasePath();
            case "${date:}":
            default:
                throw new Error("Failed to susbstitute variable: " + variableStr);
        }
    }


    public getTemplatesDirectory(): Q.Promise<string> {
        let deferred: Q.Deferred<string> = Q.defer();
        Q.fcall(() => {
            
            let configDir = this.config.get<string>('templates-directory');

            if (configDir != null && configDir.length > 0) {
                configDir = this.resolvePath(configDir);
            } else {
                // default is .vscode in base (we want this folder to be synced)
                configDir = Path.resolve(this.getBasePath(), ".vscode");
            }


            util.checkIfFileIsAccessible(configDir)
                .catch((err) => {
                    return Q.nfcall(fs.mkdir, configDir)
                })
                .then(() => {
                    // check if page template is there
                    let filePath: string = Path.join(configDir, "journal.page-template.md");
                    return util.checkIfFileIsAccessible(filePath);
                })
                .catch((err) => {
                    // template not there, copy from extension directory
                    return this.initializeTemplateDir(configDir);
                })
                .then(() => {
                    deferred.resolve(configDir);
                })
                .catch((err) => {
                    deferred.reject("Failed to initialize the configuration: " + err);
                })
                .done();
        });



        return deferred.promise;
    }

    private initializeTemplateDir(configDir: string): Q.Promise<void> {
        let deferred: Q.Deferred<void> = Q.defer();

        let ext: vscode.Extension<any> = vscode.extensions.getExtension("pajoma.vscode-journal");
        let source: string = Path.resolve(ext.extensionPath, "res", "configs");

        Q.all([

            this.copyTask(source, configDir, "journal.page-template.md"),
            this.copyTask(source, configDir, "journal.note-template.md"),
            this.copyTask(source, configDir, "journal.inline-templates.json"),
            Q.fcall(() => {
                // we only copy the new settings file if one doesn't exist
                util.checkIfFileIsAccessible(Path.join(configDir, "settings.json"))
                    .catch(() => {
                        this.copyTask(source, configDir, "settings.json")
                    })
            })

        ]
        )
            .then(() => deferred.resolve(null))
            .catch((err) => deferred.reject("Error copying: " + err));

        return deferred.promise;


    }



    // defaults to md
    public getFileExtension(): string {
        let ext: string = this.config.get<string>('ext');
        if (ext.startsWith(".")) ext = ext.substring(1, ext.length);
        return (ext.length > 0) ? ext : 'md';
    }

    private configFiles: Map<string, { detail: string, filename: string }> = null;
    public getConfigFileDefinitions(): Map<string, { detail: string, filename: string }> {
        if (this.configFiles == null) {
            this.configFiles = new Map();
            this.configFiles.set("tpl.entry", { detail: "Template for journal entries", filename: "journal.page-template.md" });
            this.configFiles.set("tpl.note", { detail: "Template for notes", filename: "journal.note-template.md" });
        }

        return this.configFiles;


    }

    /**
     * Load the page template from the resource directory (in .vscode in workspace)
     */
    public getJournalEntryTemplate(): Q.Promise<string> {
        let deferred: Q.Deferred<string> = Q.defer();

        this.getTemplatesDirectory()
            .then(configPath => Q.nfcall(fs.readFile, Path.join(configPath, this.getConfigFileDefinitions().get("tpl.entry").filename), "utf-8"))
            .then((data: Buffer) => deferred.resolve(data.toString()))
            .catch((reason: any) => deferred.reject("Failed to get page template. Reason: " + reason));
        return deferred.promise;
    }

    public getHeaderTemplate(_scopeId?: string): string {
        let scopeId = _scopeId ? _scopeId : SCOPE_DEFAULT;
        let templates: Array<InlineTemplate> = this.config.get("inline-templates"); 
        return templates.find((entry: InlineTemplate) => entry.scope === scopeId+".entry.header").template; 
    }


    public getNotesTemplate(): Q.Promise<string> {
        let deferred: Q.Deferred<string> = Q.defer();

        this.getTemplatesDirectory()
            .then(configPath => Q.nfcall(fs.readFile, Path.join(configPath, this.getConfigFileDefinitions().get("tpl.note").filename), "utf-8"))
            .then((data: Buffer) => deferred.resolve(data.toString()))
            .catch((reason: any) => deferred.reject("Failed to get note template. Reason: " + reason));
        return deferred.promise;
    }

    public getJournalConfig(): Q.Promise<Root> {
        throw "Not yet implemented";
        /*
        let deferred: Q.Deferred<any> = Q.defer();
        this.getTemplatesDirectory()
            .then(configPath => Q.nfcall(fs.readFile, Path.join(configPath, this.getConfigFileDefinitions().get("config").filename), "utf-8"))
            .then((data: Buffer) => {
                // strip comments
                let json: string = "";
                data.toString().split("\n").forEach(line => {
                    if (!line.trim().startsWith("//")) json = json.concat(line);
                });


                let tpl: Root = JSON.parse(json);

                this.inlineTemplates = tpl;
                deferred.resolve(tpl);
            })
            .catch((reason: any) => deferred.reject("Failed to get journal configuration. Reason: " + reason));
        return deferred.promise;
        */
    }

    /*
    private getInlineTemplates(): Q.Promise<any> {
        let deferred: Q.Deferred<string> = Q.defer();


        this.getConfigPath()
            .then(configPath => Q.nfcall(fs.readFile, Path.join(configPath, this.getConfigFileDefinitions().get("json.templates").filename), "utf-8"))
            .then((data: Buffer) => {
                // strip comments
                let json: string = "";
                data.toString().split("\n").forEach(line => {
                    if (!line.trim().startsWith("//")) json = json.concat(line);
                });
                this.inlineTemplates = JSON.parse(json);
                deferred.resolve(this.inlineTemplates);
            })
            .catch((reason: any) => deferred.reject("Failed to get configuration of inline templates. Reason: " + reason));
        return deferred.promise;
    }*/

    public getMemoTemplate(_scopeId?: string): Q.Promise<InlineTemplate> {
        let deferred: Q.Deferred<InlineTemplate> = Q.defer();

        Q.fcall(() => {
            let scopeId = _scopeId ? _scopeId : SCOPE_DEFAULT;

            let templatesArray: InlineTemplate[] = this.config.get("inline-templates");
            let result: InlineTemplate = templatesArray.find((tpl: InlineTemplate) => tpl.id === scopeId + ".entry.memo");
            deferred.resolve(result);
        })

        return deferred.promise;
    }

    public getFileLinkTemplate(_scopeId?: string): Q.Promise<InlineTemplate> {
        let deferred: Q.Deferred<InlineTemplate> = Q.defer();

        this.getJournalConfig()
            .then(val => {
                let scope: Scope = findScope(val.scopes, _scopeId);
                let tpl: InlineTemplate = findTemplate(scope.entry.templates, "file");

                // template not found? fall back to default
                if (!tpl) {
                    tpl = findTemplate(findScope(val.scopes, SCOPE_DEFAULT).entry.templates, "file");
                }

                deferred.resolve(tpl);
            })
            .catch((err) => deferred.reject(err));
        return deferred.promise;
    }

    public getTaskTemplate(_scopeId?: string): Q.Promise<InlineTemplate> {
        let deferred: Q.Deferred<InlineTemplate> = Q.defer();

        this.getJournalConfig()
            .then(val => {
                let scope: Scope = findScope(val.scopes, _scopeId);
                let tpl: InlineTemplate = findTemplate(scope.entry.templates, "task");

                // template not found? fall back to default
                if (!tpl) {
                    tpl = findTemplate(findScope(val.scopes, SCOPE_DEFAULT).entry.templates, "task");
                }

                deferred.resolve(tpl);
            })
            .catch((err) => deferred.reject(err));
        return deferred.promise;

    }

    public getNotesFilePattern(_scopeId?: string): Q.Promise<string> {
        let deferred: Q.Deferred<string> = Q.defer();

        this.getJournalConfig()
            .then(config => {
                let scope: Scope = findScope(config.scopes, _scopeId);
                try {
                    deferred.resolve(scope.note.file);
                } catch (error) {
                    deferred.resolve(findScope(config.scopes, SCOPE_DEFAULT).note.file);
                }
            })
            .catch(deferred.reject);

        return deferred.promise;
    }

    public getNotesPathPattern(_scopeId?: string): Q.Promise<string> {
        let deferred: Q.Deferred<string> = Q.defer();

        this.getJournalConfig()
            .then(config => {
                let scope: Scope = findScope(config.scopes, _scopeId);
                try {
                    deferred.resolve(scope.note.file);
                } catch (error) {
                    deferred.resolve(findScope(config.scopes, SCOPE_DEFAULT).note.file);
                }
            })
            .catch(deferred.reject);

        return deferred.promise;
    }





    /**
     * Copy files from target to source directory (used to initialize configuration directory)
     * 
     * @param source Source Directory
     * @param target Target Directory
     * @param file  File to copy
     */
    private copyTask(source, target, file): Q.Promise<void> {
        let deferred: Q.Deferred<void> = Q.defer();

        Q.fcall(() => {
            fs.createReadStream(Path.join(source, file)).pipe(fs.createWriteStream(Path.join(target, file)));
            deferred.resolve(null);
        });

        // copy everything in there to configDir
        // fs.createReadStream('test.log').pipe(fs.createWriteStream('newLog.log'));

        return deferred.promise;
    }
}