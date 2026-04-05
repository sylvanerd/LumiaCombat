/**
 * GPU Particles Trail Mesh Builder.js
 *
 * Creates a trail mesh with specified number of segments for GPU Particles material with Trails enabled.
 * The trail is a specialized quad split into multiple segments with red vertex color. This is the
 * default way that GPU Particles checks if a vertex is part of a trail or not.
*/

//@input Asset.Material particleTrailsMaterial  {"label":"GPU Particles Trails Material", "hint":"Make sure Trails is enabled on your GPU Particles Material."}
//@input int segmentCount = 20 {"min":2, "hint":"For optimal performance, try to use as few segments as possible. Particles more curved movement generally require more particles, while straighter movement needs less particles."}
//@input bool addHead {"label":"Add Head Particle", "hint":"When enabled, adds a quad as the head particle."}

// ------------------------------------------------------------------------------------
// Main
var meshVisual;
var builder;

if (ValidateInput()) {
    CreateTrail();
}

// ------------------------------------------------------------------------------------
// Validate Input
function ValidateInput() {
    if(!script.particleTrailsMaterial) {
        print("ERROR: please assign GPU Particles Materail to script.");
        return false;
    }

    // create render mesh visual
    meshVisual = script.getSceneObject().createComponent("Component.RenderMeshVisual");
    meshVisual.mainMaterial = script.particleTrailsMaterial;
    return true;
}

// Create Trail Mesh
function CreateTrail() {
    // ------------------------------------------------------------------------------------
    // Initialize Builder Settings
    builder = new MeshBuilder([
        { name: "position", components: 3 },
        { name: "normal", components: 3, normalized: true },
        { name: "texture0", components: 2 },
        { name: "color", components: 4}
    ]);

    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;

    // Position and UV basis
    var left = 0.0;
    var right = 1.0;

    // normal
    var normal = [0,0,1];

    // vertex colors
    var black = [0, 0, 0, 1];
    var red = [1, 0, 0, 1];

    var segmentCount = script.segmentCount;
    var segmentHeight = 1.0 / segmentCount;

    // ------------------------------------------------------------------------------------
    // Create the Trail Mesh
    // ------------------------------------------------------------------------------------
    //  quads use this triangle index pattern:
    //  0----1      
    //  | \  |      triangle 1: 0, 2, 3
    //  |  \ |      triangle 2: 3, 1, 0
    //  2----3
    //  quads will always have a height of 1, with both the vertex and UV range being [0,1]
    // ------------------------------------------------------------------------------------

    // build the first 2 vertices in the strip, which are always at the top
    builder.appendVertices( [[left, 1, 0],  normal,   [left, 1],    red]);  // top left ------- index = 0 + i * 2;
    builder.appendVertices( [[right, 1, 0], normal,   [right, 1],   red]);  // top right ------ index = 1 + i * 2;
    var height = 1.0;
    var vertexColor = red; // red indicates that the vertex is part of a trail

    // procedurally build the rest of the trail
    for(var i = 0; i < segmentCount; i++) {
        // shift the bottom down by segment height (B is initialized to be the same height as T)
        height -= segmentHeight;

        // note that the tops of the quads have already been created
        // top left ------- index = 0 + i * 2;
        // top right ------ index = 1 + i * 2;

        // append new data          position            normal  UV                  vertex color    index
        builder.appendVertices([    [left, height, 0],  normal, [left, height],     vertexColor]);  // bottom left ---- index = 2 + i * 2;
        builder.appendVertices([    [right, height, 0], normal, [right, height],    vertexColor]);  // bottom right --- index = 3 + i * 2;

        // build triangle using the 2 new vertices and 2 previous vertices
        var offset = i * 2;
        builder.appendIndices([
            0 + offset, 2 + offset, 3 + offset, // triangle 1: [0,2,3]
            3 + offset, 1 + offset, 0 + offset  // triangle 2: [3,1,0]
        ]);
    }

    // ------------------------------------------------------------------------------------
    // Add Head Particle
    if(script.addHead) {
        vertexColor = black; // black indicates that this not part of the trail for GPU Particles material

        // append vertex data    position           normal  UV          vertex color    index
        builder.appendVertices( [[left,  1.0, 0],  normal, [left,  1],  vertexColor]);  // top left ------- index = 0
        builder.appendVertices( [[right, 1.0, 0],  normal, [right, 1],  vertexColor]);  // top right ------ index = 1
        builder.appendVertices( [[left,  0.0, 0],  normal, [left,  0],  vertexColor]);  // bottom left ---- index = 2
        builder.appendVertices( [[right, 0.0, 0],  normal, [right, 0],  vertexColor]);  // bottom right --- index = 3

        // build triangles
        var offset = (segmentCount + 1) * 2;
        builder.appendIndices([
            0 + offset, 2 + offset, 3 + offset, // triangle 1: [0,2,3]
            3 + offset, 1 + offset, 0 + offset  // triangle 2: [3,1,0]
        ]);
    }

    // ------------------------------------------------------------------------------------
    // Build and Apply Mesh
    if(builder.isValid()){
        meshVisual.mesh = builder.getMesh();
        builder.updateMesh();
    } else {
        print("ERROR: Mesh data invalid!");
    }
}