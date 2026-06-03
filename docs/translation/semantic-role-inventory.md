# Semantic Role Inventory

This inventory tracks gist object-property relations whose generated TypeDB roles may be too generic when emitted as `<relation>Subject` and `<relation>Object`.

The translator now supports explicit semantic role overrides. In this release, only `gist:isProducedBy` is overridden:

```typeql
relation isProducedBy,
    relates product,
    relates producer;
```

The inventory below is intentionally conservative. A candidate appears here when the upstream label, definition, or examples suggest stable participant names that would make downstream schema extensions and queries read more naturally.

## Implemented Override

| Relation | Current roles | Semantic roles | Rationale |
| --- | --- | --- | --- |
| `isProducedBy` | `isProducedBySubject`, `isProducedByObject` | `product`, `producer` | Upstream defines the subject as something created, composed, or brought into existence by the object. |

## High-Confidence Candidates

These relations have clear natural-language participants and are likely good candidates for future explicit role overrides.

| Relation | Suggested subject role | Suggested object role | Evidence |
| --- | --- | --- | --- |
| `allows` | `permission` | `allowedActivity` | Relates a permission to an activity or type of activity it allows. |
| `comesFromAgent` | `transfer` | `originatingAgent` | Relates something to the originating agent; subproperty of `hasParticipant`. |
| `comesFromPlace` | `thing` | `originPlace` | Relates something to its place of origin. |
| `goesToAgent` | `transfer` | `receivingAgent` | Relates something to the agent that receives it; subproperty of `hasParticipant`. |
| `goesToPlace` | `thing` | `destinationPlace` | Relates something to its destination place. |
| `hasAccuracy` | `measuredMagnitude` | `accuracyMagnitude` | Relates a magnitude to another magnitude that describes its accuracy. |
| `hasAddress` | `addressedThing` | `address` | Relates something to its physical or electronic address. |
| `hasAspect` | `magnitude` | `aspect` | Relates a magnitude to its measurable characteristic. |
| `hasBiologicalParent` | `child` | `biologicalParent` | Relates a living thing to its biological parent. |
| `hasGiver` | `exchange` | `giver` | Relates something to the participant that provides it. |
| `hasGoal` | `directedThing` | `goal` | Relates something to the end towards which it directs effort. |
| `hasIncumbent` | `position` | `incumbent` | Relates a position to the thing or person that currently holds it. |
| `hasMagnitude` | `measuredThing` | `magnitude` | Relates a thing to a magnitude. |
| `hasParticipant` | `participationContext` | `participant` | Relates an agreement, event, or similar context to involved things. |
| `hasParty` | `partyContext` | `party` | Relates an event, agreement, or obligation to a participating party. |
| `hasPhysicalLocation` | `locatedThing` | `physicalLocation` | Relates something to its physical location. |
| `hasRecipient` | `exchange` | `recipient` | Relates something to the participant that receives or is intended to receive it. |
| `hasUnitGroup` | `aspect` | `unitGroup` | Relates an aspect to a unit group. |
| `hasUnitOfMeasure` | `magnitude` | `unitOfMeasure` | Relates a magnitude to its unit of measure. |
| `isAbout` | `content` | `subjectMatter` | Upstream definition: subject matter of a document. |
| `isAffectedBy` | `affectedThing` | `effectSource` | Relates an affected thing to the source of the effect. |
| `isAllocatedBy` | `allocatedThing` | `allocator` | Relates something to whoever or whatever assigns or distributes it. |
| `isAssignmentOf` | `assignment` | `assignedResource` | Relates an assignment to the resource it assigns. |
| `isAssignmentTo` | `assignment` | `assignmentTarget` | Relates an assignment to the thing the resource is assigned to. |
| `isBasedOn` | `derivedThing` | `basis` | The object is a foundation, starting point, source, or justification for the subject. |
| `isCategorizedBy` | `categorizedThing` | `category` | Relates something to a taxonomy term or classification. |
| `isDirectPartOf` | `part` | `whole` | Direct version of part-whole relation. |
| `isExpressedIn` | `expressedThing` | `language` | Relates something to the language it is expressed in. |
| `isFirstMemberOf` | `firstMember` | `orderedCollection` | Relates the first member to the ordered collection. |
| `isGovernedBy` | `governedThing` | `governingAuthority` | Relates an entity to something that controls or guides it. |
| `isIdentifiedBy` | `identifiedThing` | `identifier` | Relates something to a content object that uniquely identifies it. |
| `isMadeUpOf` | `madeThing` | `substance` | Relates something to a substance it is made of. |
| `isMemberOf` | `member` | `collection` | Relates a member individual to a collection, organization, or similar whole. |
| `isPartOf` | `part` | `whole` | Part-whole relation. |
| `isRecognizedBy` | `recognizedThing` | `recognizingParty` | Relates something to a party formally acknowledging it. |
| `isRenderedOn` | `content` | `renderingMedium` | Relates content to the medium on which it is rendered. |
| `isTriggeredBy` | `triggeredThing` | `triggeringEvent` | Relates a contingency to the event that gives rise to it. |
| `isUnderJurisdictionOf` | `jurisdictionalThing` | `jurisdiction` | Relates a law, contract, etc. to the legal or governmental system with authority over it. |
| `linksFrom` | `networkLink` | `originNode` | Directed network-link origin. |
| `linksTo` | `networkLink` | `destinationNode` | Directed network-link destination. |
| `occursIn` | `occurrence` | `place` | Relates an event-like thing to the geographic location where it happens. |
| `offersToProvide` | `offer` | `providedThing` | Relates an offer to the thing made available for exchange. |
| `offersToReceive` | `offer` | `expectedThing` | Relates an offer to the thing expected in return. |
| `owns` | `owner` | `ownedThing` | Relates a party to something it possesses and controls. |
| `prevents` | `intention` | `prohibitedBehavior` | Relates an intention to behavior that it prohibits. |
| `providesOrderFor` | `orderedMember` | `orderedItem` | Links an ordered collection member to the real-world item it represents. |

## Needs Modeling Decision

These relations also suffer from generic role names, but their best semantic roles are less obvious because the relationship is symmetric, very general, or intentionally abstract.

| Relation | Possible roles | Reason to defer |
| --- | --- | --- |
| `conformsTo` | `conformingThing`, `standard` | Likely clear, but object can be a rule, requirement, expectation, or standard. |
| `contributesTo` | `contributorPart`, `contributedSystem` | Definition mixes part-whole and goal/function semantics. |
| `hasAddend` | `sumAspect`, `addend` | Applies to aspect arithmetic; should be reviewed with unit/aspect modeling. |
| `hasBroader` | `narrowerThing`, `broaderThing` | Good candidate, but taxonomy semantics may need consistency with direct/unique variants. |
| `hasDirectBroader` | `narrowerThing`, `directBroaderThing` | Should be handled with `hasBroader`. |
| `hasDivisor` | `dividendThing`, `divisor` | Applies to both units and aspects. |
| `hasMultiplier` | `factoredThing`, `multiplier` | Applies to both units and aspects. |
| `hasNavigationalParent` | `childCategory`, `parentCategory` | Good candidate, but should be handled with unique parent variant. |
| `hasSubtrahend` | `differenceAspect`, `subtrahend` | Aspect arithmetic role names need domain review. |
| `hasUniqueBroader` | `narrowerThing`, `uniqueBroaderThing` | Should be handled with `hasBroader`. |
| `hasUniqueNavigationalParent` | `childCategory`, `uniqueParentCategory` | Should be handled with `hasNavigationalParent`. |
| `isConnectedTo` | `endpoint`, `endpoint` | Symmetric peer relation; TypeDB may need duplicate role semantics rather than directional roles. |
| `isGeoContainedIn` | `containedPlace`, `containingPlace` | Good candidate, but should be checked against broader geospatial conventions. |
| `links` | `networkLink`, `networkNode` | Undirected or unknown direction; should align with `linksFrom` and `linksTo`. |
| `precedes` | `predecessor`, `successor` | Good candidate, but should be handled with `precedesDirectly`. |
| `precedesDirectly` | `predecessor`, `successor` | Should be handled with `precedes`. |
| `refersTo` | `referringThing`, `referent` | Very broad relation; role names are plausible but generic. |
| `requires` | `requiringThing`, `requirement` | Clear enough for many uses, but object may be mandatory, necessary, or prerequisite. |

