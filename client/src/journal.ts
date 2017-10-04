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


'use strict';

import * as vscode from 'vscode';
import * as Q from 'q';
import * as journal from './util';


/**
 * Encapsulates everything needed for the Journal extension. 
 */
export default class Journal {
    private util: journal.Util;
    private config: journal.Configuration;
    private parser: journal.Parser;
    private writer: journal.Writer;
    private vsExt: journal.VSCode;
    private reader: journal.Reader;


    constructor(private vscodeConfig: vscode.WorkspaceConfiguration) {
        this.config = new journal.Configuration(vscodeConfig);
        this.util = new journal.Util(this.config);
        this.parser = new journal.Parser(this.config, this.util);
        this.writer = new journal.Writer(this.config);
        this.reader = new journal.Reader(this.config, this.util);
        this.vsExt = new journal.VSCode(this.config, this.writer);
    }


    /**
     * Displays a picklist of recent journal pages (with number of open tasks and notes next to it). The user is still able to enter arbirtraty values. 
     * 
     * Not working yet (current API does not support combolists, it's either picklist or input box)
     */
    public openDayByInputOrSelection(): Q.Promise<vscode.TextDocument> {
        let deferred: Q.Deferred<vscode.TextDocument> = Q.defer<vscode.TextDocument>();


        this.gatherSelection()
            .then(items => {
                console.log(JSON.stringify(items));

                return this.vsExt.getUserInputComboSync("Enter day or memo (with flags)", items)
            }
            )
            .then((value: string) => this.parser.tokenize(value))
            .then((input: journal.Input) => this.getPageForDay(input.offset))
            .then((doc: vscode.TextDocument) => deferred.resolve(doc))
            .catch((err) => {
                if (err != 'cancel') {
                    let msg = 'Failed to translate input into action';
                    vscode.window.showErrorMessage(msg);
                    deferred.reject(msg)
                }
            });

        return deferred.promise;
    }



    /**
     * Opens the editor for a specific day. Supported values are explicit dates (in ISO format),
     * offsets (+ or - as prefix and 0) and weekdays (next wednesday) 
     */
    public openDayByInput(): Q.Promise<vscode.TextEditor> {
        let deferred: Q.Deferred<vscode.TextEditor> = Q.defer<vscode.TextEditor>();
        let inputVar: journal.Input = null;
        let docVar: vscode.TextDocument = null;

        this.vsExt.getUserInput("Enter day or memo (with flags) ")
            .then((value: string) => {
                return this.parser.tokenize(value)
            })
            .then((input: journal.Input) => {
                inputVar = input;
                return this.getPageForDay(input.offset)
            })
            .then((doc: vscode.TextDocument) => {
                return this.addMemo(inputVar, doc)
            })
            .then((doc: vscode.TextDocument) => {
                return this.vsExt.showDocument(doc)
            })
            .then((doc: vscode.TextEditor) => {

                deferred.resolve(doc)
            })
            .catch((err) => {
                if (err != 'cancel') {
                    let msg = 'Failed to open page. Reason: \"' + err + "\"";
                    console.log(msg)
                    vscode.window.showErrorMessage(msg);
                    deferred.reject(msg)
                }
            });

        return deferred.promise;
    }


    /**
     * Opens an editor for a day with the given offset. If the page doesn't exist yet, it will be created (with the current date as header) 
     * @param {number} offset - 0 is today, -1 is yesterday
     */
    public openDay(offset: number): Q.Promise<vscode.TextEditor> {
        var deferred: Q.Deferred<vscode.TextEditor> = Q.defer<vscode.TextEditor>();

        this.getPageForDay(offset)
            .then(this.vsExt.showDocument)
            .then(deferred.resolve)
            .catch((err) => {
                let msg = 'Failed to open today\'s page. Reason: ' + err;
                vscode.window.showErrorMessage(msg);
                deferred.reject(msg)
            })

            ;
        return deferred.promise;
    }


    /**
     * Returns the page for a day with the given offset. If the page doesn't exist yet, it will be created (with the current date as header) 
     * @param {number} offset - 0 is today, -1 is yesterday
     */
    public getPageForDay(offset: number): Q.Promise<vscode.TextDocument> {
        let deferred: Q.Deferred<vscode.TextDocument> = Q.defer<vscode.TextDocument>();

        if (isNaN(offset)) deferred.reject("Journal: Not a valid value for offset");

        let date = new Date();
        date.setDate(date.getDate() + offset);


        this.util.getFileForDate(date)
            .then((path: string) => {
                return this.vsExt.loadTextDocument(path)
            })

            .catch((path: string) => {
                // create a promise in a promise, what could go wrong?
                let deferred: Q.Deferred<vscode.TextDocument> = Q.defer();

                let date = new Date();
                date.setDate(date.getDate() + offset);

                this.config.getPageTemplate()
                    .then((tpl: string) => tpl.replace('{header}', this.util.formatDate(date)))
                    .then((content) => this.vsExt.createSaveLoadTextDocument(path, content))
                    .then((doc: vscode.TextDocument) => deferred.resolve(doc));

                return deferred.promise;

            })

            .then((doc: vscode.TextDocument) => {
                if (this.config.isDevEnabled()) console.log("[Journal]", "Loaded file:", doc.uri.toString());
                this.synchronizeReferencedFiles(doc);
                deferred.resolve(doc);
            })

            .catch(reason => {
                console.log("[Journal]", "Failed to get file, Reason: ", reason);
                deferred.reject("Failed to open file");
            })




        return deferred.promise;
    }

    /**
     * Creates a new file in a subdirectory with the current day of the month as name. 
     * Shows the file to let the user start adding notes right away. 
     */
    public createNote(): Q.Promise<vscode.TextEditor> {
        var deferred: Q.Deferred<vscode.TextEditor> = Q.defer<vscode.TextEditor>();

        // let content: string = this.config.getNotesPagesTemplate();
        let label: string;
        let content: string = null; 

        this.config.getNotesPagesTemplate()
            .then(tplInfo => {
                content = tplInfo; 
                return  this.vsExt.getUserInput("Enter name for your notes"); 
            })
            .then((input: string) => {
                label = input;
                content = content.replace('{content}', input)
                return this.util.normalizeFilename(input);
            })
            .then((filename: string) => {
                return this.util.getFilePathInDateFolder(new Date(), filename);
            })
            .then((path: string) => {
                return this.vsExt.loadTextDocument(path);
            })
            .catch((filename: string) => {
                if (filename != "cancel") {
                    return this.vsExt.createSaveLoadTextDocument(filename, content);
                } else {
                    throw "cancel";
                }

            })
            .then((doc: vscode.TextDocument) => {
                /* add reference to today's page
                this.getPageForDay(0).then((pagedoc: vscode.TextDocument) => {
                    let folder: string = this.util.getFileInURI(pagedoc.uri.path); 
                    let file: string = this.util.getFileInURI(doc.uri.path, true); 

                    this.writer.insertContent(pagedoc, this.config.getNotesTemplate(),
                        ["{label}", label],
                        ["{link}", "./"+folder+"/"+file]
                    );
                }); 
                */


                return this.vsExt.showDocument(doc);
            })
            .then((editor: vscode.TextEditor) => {
                this.getPageForDay(0);  //triggeres synchronize of referenced files
                deferred.resolve(editor);
            })
            .catch((err) => {
                if (err != 'cancel') {
                    deferred.reject("Failed to create a new note. Reason is [" + err + "]");
                }
            });

        return deferred.promise;
    }

    /**
     * Adds a new memo to today's page. A memo is a one liner (entered in input box), 
     * which can be used to quickly write down ToDos without leaving your current 
     * document.
     */
    public addMemo(input: journal.Input, doc: vscode.TextDocument): Q.Promise<vscode.TextDocument> {
        var deferred: Q.Deferred<vscode.TextDocument> = Q.defer<vscode.TextDocument>();

        if (!input.hasMemo() || !input.hasFlags()) deferred.resolve(doc);
        else {
            this.writer.writeInputToFile(doc, new vscode.Position(2, 0), input)
                .then(doc => deferred.resolve(doc))
                .catch(() => deferred.reject("Failed to add memo"));

        }
        return deferred.promise;

    }


    /**
     * Called by command 'journal:open'. Opens a new windows with the journal base directory as root. 
     * 
     * 
     */
    public openJournal(): Q.Promise<void> {
        var deferred: Q.Deferred<void> = Q.defer<void>();

        let path = vscode.Uri.file(this.config.getBasePath());
        vscode.commands.executeCommand('vscode.openFolder', path, true)
            .then(success => {
                deferred.resolve(null);
            },
            deferred.reject);

        return deferred.promise;
    }

    /**
     * Configuration parameters for the Journal Extension
     */
    public getConfig(): journal.Configuration {
        return this.config;
    }





    /*********  PRIVATE METHODS FROM HERE *********/

    /** 
     * Opens a specific page depending on the input 

    private open(input: journal.Input): Q.Promise<vscode.TextDocument> {
        var deferred: Q.Deferred<vscode.TextDocument> = Q.defer<vscode.TextDocument>();

        if (input.hasMemo() && input.hasFlags()) {
            return this.addMemo(input);
        }

        if (input.hasOffset()) {
            return this.openDay(input.offset);
        }
        return deferred.promise;
    };     */


    /**
    < * Loads input selection (DEV feature)
     */
    private gatherSelection(): Q.Promise<[journal.PickDayItem]> {
        let deferred: Q.Deferred<[journal.PickDayItem]> = Q.defer<[journal.PickDayItem]>();

        let res: [journal.PickDayItem] = <[journal.PickDayItem]>new Array();
        this.reader.getPreviousJournalFiles()
            .then(files => {
                files.forEach(file => {
                    res.push(new journal.PickDayItem(file, "This is a generic desc"));
                });
                deferred.resolve(res);

            });

        this.reader.getPreviousJournalFiles();

        return deferred.promise;
    }

    private synchronizeReferencedFiles(doc: vscode.TextDocument): void {
        // we invoke the scan of the notes directory in paralell
        Q.all([
            this.reader.getReferencedFiles(doc),
            this.reader.getFilesInNotesFolder(doc)
        ]).then(results => {
            // for each file, check wether it is in the list of referenced files
            let referencedFiles: string[] = results[0];
            let foundFiles: string[] = results[1];

            foundFiles.forEach((file, index, array) => {
                let m: string = referencedFiles.find(match => match == file);
                if (m == null) {
                    if (this.config.isDevEnabled()) console.log("not present: " + file);
                    // construct local reference string
                    this.config.getFileLinkTemplate()
                        .then(tplInfo => {
                            this.writer.insertContent(doc, tplInfo,
                                ["{label}", this.util.denormalizeFilename(file)],
                                ["{link}", "./" + this.util.getFileInURI(doc.uri.path) + "/" + file]
                            );
                        }); 
                   


                }
            });

            console.log(JSON.stringify(results));
        }).catch((err) => {
            let msg = 'Failed to synchronize page with notes folder. Reason: ' + err;
            vscode.window.showErrorMessage(msg);
        })


    }













}