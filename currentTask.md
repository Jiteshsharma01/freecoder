src/
├── agent/
│   ├── agent.ts
│   ├── contextBuilder.ts
│   ├── taskPlanner.ts
│   ├── types.ts
│   ├── tools/
│   │   ├── index.ts
│   │   ├── readFile.ts
│   │   ├── searchProject.ts
│   │   ├── findReferences.ts
│   │   └── getDependencies.ts
│   └── changes/
│       ├── types.ts
│       └── applyChanges.ts
│
├── project/
│   ├── analyzer/
│   ├── mapper/
│   └── knowledgeGraph/
│
├── ai/
│
└── extension.ts


### Add the review step

User:
"Add loading state"

    ↓

FreeCopilot

Analyzing current file...

    ↓

┌────────────────────────┐
│ Proposed Changes                               │
│                                     			        │
│ Header.tsx                          		        │
│ ✏ Add loading state                		│
│                                     				│
│ Header.test.tsx                     		│
│ ✏ Add loading-state test           		│
│                                     				│
│ [ Review Diff ]                     			│
│ [Apply Changes] [Cancel]            	│
└────────────────────────┘

    ┌──────────┐
              	 │ User Message  │
                 └─────┬────┘
                          │
                          ▼
                 Active Text Editor
                          │
                          ▼
                 Current File Context
                          │
                          ▼
                  Knowledge Graph
                          │
                          ▼
                  Related Files
                          │
                          ▼
                       AI
                          │
                          ▼
                     Agent Plan
                          │
                          ▼
                  ┌───────────────┐
                  │ User Reviews  │
                  └───────┬───────┘
                          │
                    ┌─────┴───────┐
                    ▼           			▼
                 Cancel       		 Apply
                                			  │
                                ▼
                         WorkspaceEdit
                                │
                                ▼
                         Modified Files


FreeCopilot
│
├── Project Analysis
│   ├── projectAnalyzer
│   ├── genericMapper
│   ├── framework detectors
│   └── file categorization
│
├── Knowledge Graph
│   ├── graphGenerator
│   ├── graphTypes
│   ├── graphView
│   └── graphStore
│
├── Context Engine          ← NEW IMPORTANT LAYER
│   ├── projectContext
│   ├── fileContext
│   └── contextSelector
│
├── Agent
│   ├── agentPlanner
│   ├── agentExecutor
│   └── fileOperations
│
└── Chat UI
