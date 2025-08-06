import { Node, mergeAttributes, PasteRule, InputRule, Extension } from '@tiptap/core';
import katex from 'katex';
import evaluatex from 'evaluatex/dist/evaluatex';

// import { v4 } from "uuid";
// This is not a secure/unpredictable ID, but this is simple and good enough for our case
function generateID() {
    // Note, that E is not included on purpose (to prevent any confusion with eulers number)
    const ALL_ALLOWED_CHARS_UPPER = [
        "A",
        "B",
        "C",
        "D",
        "F",
        "G",
        "H",
        "I",
        "J",
        "K",
        "L",
        "M",
        "N",
        "O",
        "P",
        "Q",
        "R",
        "S",
        "T",
        "U",
        "V",
        "W",
        "X",
        "Y",
        "Z",
    ];
    const RAND_ID_LEN = 36;
    let id = "";
    for (let i = 1; i <= RAND_ID_LEN; i++) {
        const c = ALL_ALLOWED_CHARS_UPPER[Math.floor(Math.random() * ALL_ALLOWED_CHARS_UPPER.length)];
        if (Math.random() > 0.5) {
            id += c.toLowerCase();
        }
        else {
            id += c;
        }
    }
    return id;
    // Alternative: use uuidv4
    // return v4()
}

function evaluateExpression(latex, variables, variableListeners) {
    try {
        const regex = /\\pi({})?/g;
        let changedLatex = latex.replace(regex, "{PI}").trim();
        let definesVariable = undefined;
        const assignmentRegex = /^(.*)\s*:=\s*/;
        const assRegexRes = assignmentRegex.exec(changedLatex);
        if (assRegexRes && assRegexRes[0]) {
            changedLatex = changedLatex.substring(assRegexRes[0].length);
            definesVariable = assRegexRes[1].trim();
        }
        const splitAtEq = changedLatex.split("=");
        if (splitAtEq[splitAtEq.length - 1].length > 0) {
            changedLatex = splitAtEq[splitAtEq.length - 1];
        }
        else if (splitAtEq.length >= 2) {
            changedLatex = splitAtEq[splitAtEq.length - 2];
        }
        const variableObj = {};
        let definedVariableID = undefined;
        let aliases = [];
        if (definesVariable) {
            aliases = getVariableAliases(definesVariable);
        }
        changedLatex = getVariableName(changedLatex.replace("}", "}"));
        console.log({ aliases, changedLatex, variables });
        for (const id in variables) {
            const variable = variables[id];
            variableObj[id] = variable.value;
            for (const alias of variable.aliases) {
                // Replace all occurences of alias with
                const regexSafeAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const r = new RegExp("(^|(?<=[^a-zA-Z]))" + regexSafeAlias + "($|(?=[^a-zA-Z]))", "g");
                console.log("changedLatex before", changedLatex);
                changedLatex = changedLatex.replace(r, id);
                console.log("changedLatex after", changedLatex);
                for (const a of aliases) {
                    if (alias === a) {
                        definedVariableID = id;
                    }
                }
            }
        }
        const res = evaluatex(changedLatex, {}, { latex: true });
        const usedVars = new Set(res.tokens.filter((t) => t.type === "SYMBOL").map((t) => t.value));
        console.log({ usedVars, res });
        const resNum = res(variableObj);
        if (definesVariable !== undefined) {
            if (definedVariableID === undefined) {
                definedVariableID = generateID();
            }
            // Cyclic dependency! Fail early
            if (usedVars.has(definedVariableID)) {
                return undefined;
            }
            variables[definedVariableID] = {
                value: resNum,
                aliases: aliases,
            };
            const listeners = variableListeners[definedVariableID];
            if (listeners != undefined) {
                for (const l of listeners) {
                    l.onUpdate();
                }
            }
        }
        return {
            definedVariableID: definedVariableID,
            variablesUsed: usedVars,
            result: resNum,
        };
    }
    catch (e) {
        console.log(e);
        return undefined;
    }
}
function getVariableAliases(variable) {
    return [getVariableName(variable), getVariableName(variable, true)];
}
function parseInnerVariablePart(variablePart, skipOptionalBrackets = false) {
    variablePart = variablePart.trim();
    let mode = "main";
    let depth = 0;
    let prevBackslash = false;
    let main = "";
    let sup = "";
    let sub = "";
    let after = "";
    let inCommand = false;
    for (const c of variablePart) {
        let writeC = true;
        if (c === "\\") {
            if (!prevBackslash && depth === 0) {
                inCommand = true;
            }
            prevBackslash = !prevBackslash;
        }
        else {
            prevBackslash = false;
        }
        if (c === " " && depth === 0) {
            inCommand = false;
        }
        if (!prevBackslash) {
            if (c === "_" && depth === 0 && mode === "main") {
                mode = "sub";
                writeC = false;
            }
            if (c === "^" && depth === 0 && mode === "main") {
                mode = "sup";
                writeC = false;
            }
            if (c === "{") {
                depth++;
            }
            if (c === "}") {
                depth--;
                if (depth === 0) {
                    inCommand = false;
                }
            }
        }
        if (mode === "main" && c === " " && depth === 0) {
            mode = "after";
            writeC = false;
        }
        if (mode === "main" && c === "\\" && depth === 0 && main != "") {
            mode = "after";
        }
        if (writeC) {
            if (mode === "main") {
                main += c;
            }
            else if (mode === "sub") {
                sub += c;
            }
            else if (mode === "sup") {
                sup += c;
            }
            else if (mode === "after") {
                after += c;
            }
            // Unless in a "group" {...}, go back to main mode
            // or command
            if ((mode === "sub" || mode == "sup") && depth === 0 && !inCommand) {
                mode = "main";
            }
        }
    }
    if (sup.startsWith("{") && sup.endsWith("}")) {
        sup = sup.substring(1, sup.length - 1);
    }
    if (sub.startsWith("{") && sub.endsWith("}")) {
        sub = sub.substring(1, sub.length - 1);
    }
    let subpart = sub.trim();
    let suppart = sup.trim();
    if (skipOptionalBrackets && subpart.indexOf(" ") === -1) {
        subpart = sub !== "" ? `_${subpart}` : "";
    }
    else {
        subpart = sub !== "" ? `_{${subpart}}` : "";
    }
    if (skipOptionalBrackets && suppart.indexOf(" ") === -1) {
        suppart = sup !== "" ? `^${sup.trim()}` : "";
    }
    else {
        suppart = sup !== "" ? `^{${sup.trim()}}` : "";
    }
    const processedAfter = after !== "" ? " " + parseInnerVariablePart(after) : "";
    return `${main}${subpart}${suppart}${processedAfter}`;
}
function getVariableName(variablePart, skipOptionalBrackets = false) {
    variablePart = variablePart.trim();
    if (variablePart.startsWith("{") && variablePart.endsWith("}")) {
        return getVariableName(variablePart.substring(1, variablePart.length - 1));
    }
    const colorRegex = /(?![^\\])\\color{\w*}/g;
    if (colorRegex.test(variablePart)) {
        return getVariableName(variablePart.replace(colorRegex, " "));
    }
    const textColorRegex = /\\textcolor{\w*}/g;
    if (textColorRegex.test(variablePart)) {
        return getVariableName(variablePart.replace(textColorRegex, " "));
    }
    return parseInnerVariablePart(variablePart, skipOptionalBrackets);
}

function updateEvaluation(latex, id, resultSpan, showEvalResult, editorStorage) {
    let evalRes = evaluateExpression(latex, editorStorage.variables, editorStorage.variableListeners); // Do not show if error occurs (in general, we probably want to make showing the result optional)
    const updateResultSpan = () => {
        var _a;
        if (evalRes === null || evalRes === void 0 ? void 0 : evalRes.result) {
            if (((_a = evalRes.result.toString().split(".")[1]) === null || _a === void 0 ? void 0 : _a.length) > 5) {
                resultSpan.innerText = "=" + evalRes.result.toFixed(4);
            }
            else {
                resultSpan.innerText = "=" + evalRes.result.toString();
            }
        }
        else {
            resultSpan.innerText = "=Error";
        }
        if (!showEvalResult) {
            resultSpan.style.display = "none";
        }
        else {
            resultSpan.style.display = "inline-block";
        }
    };
    updateResultSpan();
    if (evalRes === null || evalRes === void 0 ? void 0 : evalRes.variablesUsed) {
        for (const v of evalRes.variablesUsed) {
            // Register Listeners
            let listenersForV = editorStorage.variableListeners[v];
            if (listenersForV == undefined) {
                listenersForV = [];
            }
            listenersForV.push({
                id: id,
                onUpdate: () => {
                    {
                        evalRes = evaluateExpression(latex, editorStorage.variables, editorStorage.variableListeners);
                        updateResultSpan();
                    }
                },
            });
            editorStorage.variableListeners[v] = listenersForV;
        }
    }
    return evalRes;
}

const DEFAULT_OPTIONS = { addInlineMath: true, evaluation: false, delimiters: "dollar", renderTextMode: "raw-latex" };

const InlineMathNode = Node.create({
    name: "inlineMath",
    group: "inline",
    inline: true,
    selectable: true,
    atom: true,
    addOptions() {
        return DEFAULT_OPTIONS;
    },
    addAttributes() {
        return {
            latex: {
                default: "x_1",
                parseHTML: (element) => element.getAttribute("data-latex"),
                renderHTML: (attributes) => {
                    return {
                        "data-latex": attributes.latex,
                    };
                },
            },
            evaluate: {
                default: "no",
                parseHTML: (element) => element.getAttribute("data-evaluate"),
                renderHTML: (attributes) => {
                    return {
                        "data-evaluate": attributes.evaluate,
                    };
                },
            },
            display: {
                default: "no",
                parseHTML: (element) => element.getAttribute("data-display"),
                renderHTML: (attributes) => {
                    return {
                        "data-display": attributes.display,
                    };
                },
            },
        };
    },
    addInputRules() {
        const inputRules = [];
        const blockRegex = getRegexFromOptions("block", this.options);
        if (blockRegex !== undefined) {
            inputRules.push(new InputRule({
                find: new RegExp(blockRegex, ""),
                handler: (props) => {
                    let latex = props.match[1];
                    if (props.match[1].length === 0) {
                        return;
                    }
                    const showRes = latex.endsWith("=");
                    if (showRes) {
                        latex = latex.substring(0, latex.length - 1);
                    }
                    let content = [
                        {
                            type: "inlineMath",
                            attrs: { latex: latex, evaluate: showRes ? "yes" : "no", display: "yes" },
                        },
                    ];
                    props
                        .chain()
                        .insertContentAt({
                        from: props.range.from,
                        to: props.range.to,
                    }, content, { updateSelection: true })
                        .run();
                },
            }));
        }
        const inlineRegex = getRegexFromOptions("inline", this.options);
        if (inlineRegex !== undefined) {
            inputRules.push(new InputRule({
                find: new RegExp(inlineRegex, ""),
                handler: (props) => {
                    if (props.match[1].length === 0) {
                        return;
                    }
                    // TODO: Better handling, also for custom regexes
                    // This prevents that $$x_1$ (a block expression in progress) is already captured by inline input rules
                    if ((this.options.delimiters === undefined || this.options.delimiters === "dollar") &&
                        (props.match[1].startsWith("$") || props.match[0].startsWith("$$"))) {
                        return;
                    }
                    let latex = props.match[1];
                    latex = latex.trim();
                    const showRes = latex.endsWith("=");
                    if (showRes) {
                        latex = latex.substring(0, latex.length - 1);
                    }
                    let content = [
                        {
                            type: "inlineMath",
                            attrs: { latex: latex, evaluate: showRes ? "yes" : "no", display: "no" },
                        },
                    ];
                    props
                        .chain()
                        .insertContentAt({
                        from: props.range.from,
                        to: props.range.to,
                    }, content, { updateSelection: true })
                        .run();
                },
            }));
        }
        return inputRules;
    },
    addPasteRules() {
        const pasteRules = [];
        const blockRegex = getRegexFromOptions("block", this.options);
        if (blockRegex !== undefined) {
            pasteRules.push(new PasteRule({
                find: new RegExp(blockRegex, "g"),
                handler: (props) => {
                    const latex = props.match[1];
                    props
                        .chain()
                        .insertContentAt({ from: props.range.from, to: props.range.to }, [
                        {
                            type: "inlineMath",
                            attrs: { latex: latex, evaluate: "no", display: "yes" },
                        },
                    ], { updateSelection: true })
                        .run();
                },
            }));
        }
        const inlineRegex = getRegexFromOptions("inline", this.options);
        if (inlineRegex !== undefined) {
            pasteRules.push(new PasteRule({
                find: new RegExp(inlineRegex, "g"),
                handler: (props) => {
                    const latex = props.match[1];
                    props
                        .chain()
                        .insertContentAt({ from: props.range.from, to: props.range.to }, [
                        {
                            type: "inlineMath",
                            attrs: { latex: latex, evaluate: "no", display: "no" },
                        },
                    ], { updateSelection: true })
                        .run();
                },
            }));
        }
        return pasteRules;
    },
    parseHTML() {
        return [
            {
                tag: `span[data-type="${this.name}"]`,
            },
        ];
    },
    renderHTML({ node, HTMLAttributes }) {
        let latex = "x";
        if (node.attrs.latex && typeof node.attrs.latex == "string") {
            latex = node.attrs.latex;
        }
        return [
            "span",
            mergeAttributes(HTMLAttributes, {
                "data-type": this.name,
            }),
            getDelimiter(node.attrs.display === "yes" ? "block" : "inline", "start", this.options) +
                latex +
                getDelimiter(node.attrs.display === "yes" ? "block" : "inline", "end", this.options),
        ];
    },
    renderText({ node }) {
        if (this.options.renderTextMode === "none") {
            return "";
        }
        if (typeof this.options.renderTextMode === 'object' && "placeholder" in this.options.renderTextMode) {
            return this.options.renderTextMode.placeholder;
        }
        let latex = "x";
        if (node.attrs.latex && typeof node.attrs.latex == "string") {
            latex = node.attrs.latex;
        }
        // if ( this.options.renderTextMode === "raw-latex") {
        return latex;
        // }
        // TODO: Maybe re-enable the delimited-latex mode once there is a way to not re-trigger the input rule :(
        // if (this.options.renderTextMode === undefined || this.options.renderTextMode === "delimited-latex") {
        // const displayMode = node.attrs.display === "yes";
        // const firstDelimiter = getDelimiter(displayMode ? "block" : "inline", "start", this.options);
        // let secondDelimiter = getDelimiter(displayMode ? "block" : "inline", "end", this.options);
        // return firstDelimiter + latex + secondDelimiter;
        // }
    },
    addKeyboardShortcuts() {
        return {
            Backspace: () => this.editor.commands.command(({ tr, state }) => {
                let isMention = false;
                const { selection } = state;
                const { empty, anchor } = selection;
                if (!empty) {
                    return false;
                }
                state.doc.nodesBetween(anchor - 1, anchor, (node, pos) => {
                    if (node.type.name === this.name) {
                        isMention = true;
                        const displayMode = node.attrs.display === "yes";
                        const firstDelimiter = getDelimiter(displayMode ? "block" : "inline", "start", this.options);
                        let secondDelimiter = getDelimiter(displayMode ? "block" : "inline", "end", this.options);
                        secondDelimiter = secondDelimiter.substring(0, secondDelimiter.length - 1);
                        tr.insertText(firstDelimiter + (node.attrs.latex || "") + secondDelimiter, pos, anchor);
                    }
                });
                return isMention;
            }),
        };
    },
    addNodeView() {
        return ({ HTMLAttributes, node, getPos, editor }) => {
            var _a;
            const outerSpan = document.createElement("span");
            const span = document.createElement("span");
            outerSpan.appendChild(span);
            let latex = "x_1";
            if ("data-latex" in HTMLAttributes && typeof HTMLAttributes["data-latex"] === "string") {
                latex = HTMLAttributes["data-latex"];
            }
            let displayMode = node.attrs.display === "yes";
            katex.render(latex, span, Object.assign({ displayMode: displayMode, throwOnError: false }, ((_a = this.options.katexOptions) !== null && _a !== void 0 ? _a : {})));
            outerSpan.classList.add("tiptap-math", "latex");
            let showEvalResult = node.attrs.evaluate === "yes";
            const id = generateID();
            const shouldEvaluate = this.options.evaluation;
            // Should evaluate (i.e., also register new variables etc.)
            if (shouldEvaluate) {
                outerSpan.title = "Click to toggle result";
                outerSpan.style.cursor = "pointer";
                const resultSpan = document.createElement("span");
                outerSpan.append(resultSpan);
                resultSpan.classList.add("tiptap-math", "result");
                resultSpan.classList.add("katex");
                //@ts-ignore
                const evalRes = updateEvaluation(latex, id, resultSpan, showEvalResult, this.editor.storage.inlineMath);
                // On click, update the evaluate attribute (effectively triggering whether the result is shown)
                outerSpan.addEventListener("click", (ev) => {
                    if (editor.isEditable && typeof getPos === "function") {
                        editor
                            .chain()
                            .command(({ tr }) => {
                            const position = getPos();
                            tr.setNodeAttribute(position, "evaluate", !showEvalResult ? "yes" : "no");
                            return true;
                        })
                            .run();
                    }
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                });
                return {
                    dom: outerSpan,
                    destroy: () => {
                        if (evalRes === null || evalRes === void 0 ? void 0 : evalRes.variablesUsed) {
                            // De-register listeners
                            for (const v of evalRes.variablesUsed) {
                                //@ts-ignore
                                let listenersForV = this.editor.storage.inlineMath.variableListeners[v];
                                if (listenersForV == undefined) {
                                    listenersForV = [];
                                }
                                //@ts-ignore
                                this.editor.storage.inlineMath.variableListeners[v] = listenersForV.filter((l) => l.id !== id);
                            }
                        }
                    },
                };
            }
            else {
                // Should not evaluate math expression (just display them)
                return {
                    dom: outerSpan,
                };
            }
        };
    },
    addStorage() {
        return {
            variables: {},
            variableListeners: {},
        };
    },
});
function getRegexFromOptions(mode, options) {
    if (options.delimiters === undefined || options.delimiters === "dollar") {
        if (mode === "inline") {
            return String.raw `(?<!\$)\$(?![$\s,.])((?:[^$\\]|\\\$|\\)+?(?<![\\\s(["]))\$`;
        }
        else {
            return String.raw `\$\$(?!\s)(.*?(?<!\\))\$\$`;
        }
    }
    else if (options.delimiters === "bracket") {
        if (mode === "inline") {
            return String.raw `\\\((.*?[^\\])\\\)`;
        }
        else {
            return String.raw `\\\[(.*?[^\\])\\\]`;
        }
    }
    else {
        if (mode === "inline") {
            return options.delimiters.inlineRegex;
        }
        else {
            return options.delimiters.blockRegex;
        }
    }
}
function getDelimiter(mode, position, options) {
    var _a, _b, _c, _d;
    if (options.delimiters === undefined || options.delimiters === "dollar") {
        if (mode === "inline") {
            return "$";
        }
        else {
            return "$$";
        }
    }
    else if (options.delimiters === "bracket") {
        if (mode === "inline") {
            if (position === "start") {
                return String.raw `\(`;
            }
            else {
                return String.raw `\)`;
            }
        }
        else {
            if (position === "start") {
                return String.raw `\[`;
            }
            else {
                return String.raw `\]`;
            }
        }
    }
    else {
        if (mode === "inline") {
            if (position === "start") {
                return (_a = options.delimiters.inlineStart) !== null && _a !== void 0 ? _a : "$";
            }
            else {
                return (_b = options.delimiters.inlineEnd) !== null && _b !== void 0 ? _b : "$";
            }
        }
        else {
            if (position === "start") {
                return (_c = options.delimiters.blockStart) !== null && _c !== void 0 ? _c : "$$";
            }
            else {
                return (_d = options.delimiters.blockEnd) !== null && _d !== void 0 ? _d : "$$";
            }
        }
    }
}

const MATH_EXTENSION_NAME = "mathExtension";
const MathExtension = Extension.create({
    name: MATH_EXTENSION_NAME,
    addOptions() {
        return DEFAULT_OPTIONS;
    },
    addExtensions() {
        const extensions = [];
        if (this.options.addInlineMath !== false) {
            extensions.push(InlineMathNode.configure(this.options));
        }
        return extensions;
    },
});

export { DEFAULT_OPTIONS, InlineMathNode, MATH_EXTENSION_NAME, MathExtension, MathExtension as default };
//# sourceMappingURL=index.js.map
